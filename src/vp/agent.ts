import { tool } from 'ai';
import { z } from 'zod';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import path from 'path';
import type { DepartmentConfig, CompanyConfig } from '../config.js';
import type { Tracker } from '../tracker.js';
import type { WorkerSession } from '../workers/types.js';
import type { ClaudeCodeClient } from '../workers/claude-code-client.js';
import { createWorktree, removeWorktree } from '../git.js';

export interface VPState {
  config: DepartmentConfig;
  companyConfig: CompanyConfig;
  tracker: Tracker;
  mcpClient: ClaudeCodeClient;
  sessions: Map<string, WorkerSession>;
  done: boolean;
  departmentDir: string;
  companyDir: string;
  log: (msg: string) => void;
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
    start_worker: tool({
      description: 'Start a new coding worker on a git branch. Returns the worker\'s first response.',
      inputSchema: z.object({
        task: z.string().describe('Task description for the worker'),
        branch_name: z.string().describe('Git branch name'),
      }),
      execute: async ({ task, branch_name }) => {
        const MAX_WORKERS = 2;
        const active = [...state.sessions.values()].filter((s) => s.status === 'active').length;
        if (active >= MAX_WORKERS) {
          throw new Error(`Cannot start worker: already ${active} active workers (max ${MAX_WORKERS}). Use continue_worker or kill_worker first.`);
        }

        state.log(`[tool:start_worker] Creating worktree for branch ${branch_name}...`);
        const worktreePath = createWorktree(state.companyConfig.repo, branch_name);

        const instructions = bootstrapWorkerInstructions(state);
        writeFileSync(path.join(worktreePath, 'CLAUDE.md'), instructions);

        const id = randomUUID().slice(0, 8);

        state.log(`[tool:start_worker] Worktree ready. Starting MCP session...`);
        const { threadId, content } = await state.mcpClient.startSession(task, worktreePath);

        const session: WorkerSession = { id, branch: branch_name, worktreePath, threadId, status: 'active' };
        state.sessions.set(id, session);
        state.tracker.logEvent('worker_started', { id, branch: branch_name, task });

        return `Worker ${id} started on branch ${branch_name}.\n\nWorker response:\n${content}`;
      },
    }),

    continue_worker: tool({
      description: 'Send a follow-up message to a running worker and get its response.',
      inputSchema: z.object({
        worker_id: z.string().describe('Worker ID'),
        message: z.string().describe('Message to send to the worker'),
      }),
      execute: async ({ worker_id, message }) => {
        const session = state.sessions.get(worker_id);
        if (!session) return `Worker ${worker_id} not found`;
        if (session.status !== 'active') return `Worker ${worker_id} is ${session.status}`;

        state.log(`[tool:continue_worker] Sending to worker ${worker_id}...`);
        const { content } = await state.mcpClient.continueSession(session.threadId, message);
        state.tracker.logEvent('worker_continued', { id: worker_id });

        return `Worker ${worker_id} response:\n${content}`;
      },
    }),

    kill_worker: tool({
      description: 'Kill a worker and clean up its worktree',
      inputSchema: z.object({
        worker_id: z.string(),
      }),
      execute: async ({ worker_id }) => {
        const session = state.sessions.get(worker_id);
        if (!session) return `Worker ${worker_id} not found`;
        state.mcpClient.killSession(session.threadId);
        try { removeWorktree(state.companyConfig.repo, session.worktreePath); } catch { /* already cleaned */ }
        session.status = 'done';
        state.tracker.logEvent('worker_killed', { id: worker_id });
        return `Worker ${worker_id} killed`;
      },
    }),

    list_workers: tool({
      description: 'List all workers and their status',
      inputSchema: z.object({}),
      execute: async () => {
        if (state.sessions.size === 0) return 'No workers';
        const lines = [...state.sessions.values()].map(
          (s) => `${s.id} | ${s.branch} | ${s.status} | thread:${s.threadId}`
        );
        return ['ID | Branch | Status | Thread', ...lines].join('\n');
      },
    }),

    mark_done: tool({
      description: 'Signal that all work is complete. Call this when the department\'s goals are met.',
      inputSchema: z.object({
        summary: z.string().describe('Final summary of what was accomplished'),
      }),
      execute: async ({ summary }) => {
        state.done = true;
        state.tracker.logEvent('vp_done', { summary });
        return `VP marked done. Summary: ${summary}`;
      },
    }),

    update_work_log: tool({
      description: 'Append an entry to WORK.md',
      inputSchema: z.object({ entry: z.string() }),
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
