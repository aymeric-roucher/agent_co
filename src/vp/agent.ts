import { tool } from 'ai';
import { z } from 'zod';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import type { DepartmentConfig, CompanyConfig } from '../config.js';
import type { Tracker } from '../tracker.js';
import type { WorkerHandle, WorkerEvent } from '../workers/types.js';
import type { EventQueue } from '../event-queue.js';
import { createWorktree, removeWorktree } from '../git.js';
import { spawnClaudeCode } from '../workers/claude-code.js';
import { spawnCodex } from '../workers/codex.js';

export interface VPState {
  config: DepartmentConfig;
  companyConfig: CompanyConfig;
  tracker: Tracker;
  workers: Map<string, WorkerHandle>;
  eventQueue: EventQueue<WorkerEvent>;
  departmentDir: string;
  companyDir: string;
}

function bootstrapWorkerInstructions(state: VPState): string {
  const agentMdPath = path.join(state.departmentDir, 'AGENT.md');
  const agentInstructions = existsSync(agentMdPath) ? readFileSync(agentMdPath, 'utf-8') : '';

  const commonDocPath = path.join(state.companyDir, 'DOC_COMMON.md');
  const deptDocPath = path.join(state.departmentDir, 'DOC.md');
  const commonDoc = existsSync(commonDocPath) ? readFileSync(commonDocPath, 'utf-8') : '';
  const deptDoc = existsSync(deptDocPath) ? readFileSync(deptDocPath, 'utf-8') : '';

  return [
    agentInstructions,
    commonDoc ? `## Shared Knowledge\n${commonDoc}` : '',
    deptDoc ? `## Department Knowledge\n${deptDoc}` : '',
    '',
    '## Rules',
    '- Write minimal, correct code. No unnecessary abstractions.',
    '- Never silently swallow errors. Raise them.',
    '- Write a comprehensive final report: what you did, what you learned, what remains.',
  ].filter(Boolean).join('\n');
}

export function createVPTools(state: VPState) {
  return {
    spawn_worker: tool({
      description: 'Spawn a new coding agent worker on a git branch',
      inputSchema: z.object({
        task: z.string().describe('Task description for the worker'),
        branch_name: z.string().describe('Git branch name'),
      }),
      execute: async ({ task, branch_name }) => {
        const worktreePath = createWorktree(state.companyConfig.repo, branch_name);

        // Write bootstrap instructions into the worktree
        const instructions = bootstrapWorkerInstructions(state);
        writeFileSync(path.join(worktreePath, 'CLAUDE.md'), instructions);

        const handle = state.companyConfig.worker_type === 'claude_code'
          ? spawnClaudeCode(worktreePath, branch_name, task, state.eventQueue)
          : spawnCodex(worktreePath, branch_name, task, state.eventQueue);

        state.workers.set(handle.id, handle);
        state.tracker.logEvent('worker_spawned', { id: handle.id, branch: branch_name, task });
        return `Worker ${handle.id} spawned on branch ${branch_name}`;
      },
    }),

    check_worker: tool({
      description: 'Check status and recent output of a worker',
      inputSchema: z.object({
        worker_id: z.string(),
      }),
      execute: async ({ worker_id }) => {
        const w = state.workers.get(worker_id);
        if (!w) return `Worker ${worker_id} not found`;
        const tail = w.outputBuffer.slice(-2000);
        return `Status: ${w.status}\nBranch: ${w.branch}\nRecent output:\n${tail}`;
      },
    }),

    send_to_worker: tool({
      description: 'Send a message to a running worker via stdin',
      inputSchema: z.object({
        worker_id: z.string(),
        message: z.string(),
      }),
      execute: async ({ worker_id, message }) => {
        const w = state.workers.get(worker_id);
        if (!w) return `Worker ${worker_id} not found`;
        if (w.status !== 'running') return `Worker ${worker_id} is ${w.status}`;
        w.process.stdin?.write(message + '\n');
        return `Message sent to worker ${worker_id}`;
      },
    }),

    kill_worker: tool({
      description: 'Kill a worker and clean up its worktree',
      inputSchema: z.object({
        worker_id: z.string(),
      }),
      execute: async ({ worker_id }) => {
        const w = state.workers.get(worker_id);
        if (!w) return `Worker ${worker_id} not found`;
        w.process.kill('SIGTERM');
        try { removeWorktree(state.companyConfig.repo, w.worktreePath); } catch { /* already cleaned */ }
        w.status = 'failed';
        state.tracker.logEvent('worker_killed', { id: worker_id });
        return `Worker ${worker_id} killed`;
      },
    }),

    list_workers: tool({
      description: 'List all workers and their status',
      inputSchema: z.object({}),
      execute: async () => {
        if (state.workers.size === 0) return 'No workers';
        const lines = [...state.workers.values()].map(
          (w) => `${w.id} | ${w.branch} | ${w.status} | ${w.workerType}`
        );
        return ['ID | Branch | Status | Type', ...lines].join('\n');
      },
    }),

    update_work_log: tool({
      description: 'Append an entry to WORK.md',
      inputSchema: z.object({
        entry: z.string(),
      }),
      execute: async ({ entry }) => {
        const workPath = path.join(state.departmentDir, 'WORK.md');
        const ts = new Date().toISOString().slice(0, 19);
        appendFileSync(workPath, `\n## ${ts}\n${entry}\n`);
        state.tracker.snapshotWorkMd(workPath);
        return 'WORK.md updated';
      },
    }),

    write_doc: tool({
      description: 'Write a document to plans/ or prds/',
      inputSchema: z.object({
        filename: z.string(),
        content: z.string(),
        folder: z.enum(['plans', 'prds']),
      }),
      execute: async ({ filename, content, folder }) => {
        const dir = path.join(state.departmentDir, folder);
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, filename), content);
        return `Written ${folder}/${filename}`;
      },
    }),

    open_pr: tool({
      description: 'Open a pull request from a branch',
      inputSchema: z.object({
        branch: z.string(),
        title: z.string(),
        body: z.string(),
      }),
      execute: async ({ branch, title, body }) => {
        const result = execSync(
          `gh pr create --head "${branch}" --title "${title}" --body "${body}"`,
          { cwd: state.companyConfig.repo, encoding: 'utf-8', stdio: 'pipe' },
        );
        state.tracker.logEvent('pr_opened', { branch, title });
        return result.trim();
      },
    }),

    update_vp_logs: tool({
      description: 'Overwrite VP_LOGS.md with current progress report',
      inputSchema: z.object({ content: z.string() }),
      execute: async ({ content }) => {
        writeFileSync(path.join(state.departmentDir, 'VP_LOGS.md'), content);
        return 'VP_LOGS.md updated';
      },
    }),

    update_doc: tool({
      description: 'Overwrite department DOC.md (knowledge base)',
      inputSchema: z.object({ content: z.string() }),
      execute: async ({ content }) => {
        writeFileSync(path.join(state.departmentDir, 'DOC.md'), content);
        return 'DOC.md updated';
      },
    }),

    update_common_doc: tool({
      description: 'Append lines to shared DOC_COMMON.md (use sparingly)',
      inputSchema: z.object({ lines: z.string() }),
      execute: async ({ lines }) => {
        const p = path.join(state.companyDir, 'DOC_COMMON.md');
        appendFileSync(p, lines + '\n');
        return 'DOC_COMMON.md updated';
      },
    }),

    read_doc: tool({
      description: 'Read department DOC.md',
      inputSchema: z.object({}),
      execute: async () => {
        const p = path.join(state.departmentDir, 'DOC.md');
        return existsSync(p) ? readFileSync(p, 'utf-8') : '(empty)';
      },
    }),

    read_common_doc: tool({
      description: 'Read shared DOC_COMMON.md',
      inputSchema: z.object({}),
      execute: async () => {
        const p = path.join(state.companyDir, 'DOC_COMMON.md');
        return existsSync(p) ? readFileSync(p, 'utf-8') : '(empty)';
      },
    }),
  };
}
