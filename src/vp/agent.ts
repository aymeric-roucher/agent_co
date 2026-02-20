import { tool } from 'ai';
import { z } from 'zod';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, copyFileSync } from 'fs';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import path from 'path';
import { execShell, formatShellResult } from './shell.js';
import type { DepartmentConfig, CompanyConfig } from '../config.js';
import type { Tracker } from '../tracker.js';
import type { WorkerSession } from '../workers/types.js';
import type { ClaudeCodeClient } from '../workers/claude-code-client.js';
import { createWorktree, removeWorktree } from '../git.js';
import { readFileContent, isImageFile } from './read-file.js';
import type { WhatsAppClient } from '../whatsapp/client.js';

export interface PendingImage {
  base64: string;
  mimeType: string;
  filePath: string;
}

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
  pendingImages: PendingImage[];
  whatsapp: WhatsAppClient | null;
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
        const MAX_WORKERS = 3;
        const active = [...state.sessions.values()].filter((s) => s.status === 'active').length;
        if (active >= MAX_WORKERS) {
          throw new Error(`Cannot start worker: already ${active} active workers (max ${MAX_WORKERS}). Use continue_worker or kill_worker first.`);
        }

        state.log(`[tool:start_worker] Creating worktree for branch ${branch_name}...`);
        const worktreeBase = path.join(state.departmentDir, 'worktrees');
        const worktreePath = createWorktree(state.companyConfig.repo, branch_name, worktreeBase);

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
      description: 'Approve or deny the worker\'s pending action. When denying, provide a reason so the worker can adjust.',
      inputSchema: z.object({
        worker_id: z.string().describe('Worker ID'),
        approve: z.boolean().describe('true to execute the action, false to deny it'),
        denial_reason: z.string().optional().describe('ONLY when approve=false: explain why or what to do instead'),
      }),
      execute: async ({ worker_id, approve, denial_reason: message }) => {
        const session = state.sessions.get(worker_id);
        if (!session) return `Worker ${worker_id} not found`;
        if (session.status !== 'active') return `Worker ${worker_id} is ${session.status}`;

        state.log(`[tool:continue_worker] ${approve ? 'Approving' : 'Denying'} worker ${worker_id}...`);

        let content: string;
        try {
          ({ content } = await state.mcpClient.continueSession(session.threadId, approve, message));
        } catch (err) {
          // Session finished or has no pending permission — mark worker done
          session.status = 'done';
          state.tracker.logEvent('worker_done', { id: worker_id, reason: String(err) });
          return `Worker ${worker_id} finished (session ended). Open a PR for branch "${session.branch}" if work is ready.`;
        }

        // Detect "DONE" in worker response — auto-mark finished
        if (content.includes('**DONE.**')) {
          session.status = 'done';
          state.tracker.logEvent('worker_done', { id: worker_id });
        }

        state.tracker.logEvent('worker_continued', { id: worker_id, approve });
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

    shell_command: tool({
      description: 'Run a shell command asynchronously. Returns stdout, stderr, and exit code.',
      inputSchema: z.object({
        command: z.string().describe('The shell command to run'),
        cwd: z.string().optional().describe('Working directory (defaults to repo root)'),
        timeout_ms: z.number().optional().describe('Timeout in ms (default 120000)'),
      }),
      execute: async ({ command, cwd, timeout_ms }) => {
        const workDir = cwd || state.companyConfig.repo;
        state.log(`[tool:shell_command] ${command}`);
        const result = await execShell(command, { cwd: workDir, timeout: timeout_ms });
        return formatShellResult(result);
      },
    }),

    read_file: tool({
      description: 'Read a file. For text files returns numbered lines. For images returns base64 data the model can view.',
      inputSchema: z.object({
        file_path: z.string().describe('Absolute path to the file'),
        offset: z.number().optional().describe('1-indexed start line (default 1)'),
        limit: z.number().optional().describe('Max lines to return (default 2000)'),
        mode: z.enum(['slice', 'indentation']).optional().describe('Read mode (default slice)'),
        anchor_line: z.number().optional().describe('Indentation mode: anchor line number'),
        max_levels: z.number().optional().describe('Indentation mode: max indent levels to collect (0=unlimited)'),
        include_siblings: z.boolean().optional().describe('Indentation mode: include sibling blocks'),
      }),
      execute: async ({ file_path, offset, limit, mode, anchor_line, max_levels, include_siblings }) => {
        if (!existsSync(file_path)) throw new Error(`File not found: ${file_path}`);

        if (isImageFile(file_path)) {
          const buf = readFileSync(file_path);
          const ext = file_path.slice(file_path.lastIndexOf('.') + 1).toLowerCase();
          const mimeType = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
          state.pendingImages.push({ base64: buf.toString('base64'), mimeType, filePath: file_path });
          state.log(`[tool:read_file] Image ${file_path} (${buf.length} bytes) — queued for visual inspection`);
          return `Image ${file_path} (${buf.length} bytes, ${mimeType}) — will be shown in next message for visual inspection.`;
        }

        const content = readFileSync(file_path, 'utf-8');
        const indentation = (mode === 'indentation')
          ? { anchorLine: anchor_line, maxLevels: max_levels ?? 0, includeSiblings: include_siblings ?? false, includeHeader: true }
          : undefined;
        return readFileContent(content, { filePath: file_path, offset, limit, mode, indentation });
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
      description: 'Commit all changes on the branch, push, and open a pull request. Images are embedded in the PR body.',
      inputSchema: z.object({
        branch: z.string(),
        title: z.string(),
        description: z.string().describe(`Markdown PR description. MUST follow this structure:
### Problem — What was wrong or missing? Why does this PR exist? (1-2 sentences)
### Solution — What does this PR do? Name files, functions, approach. (bullet points)
### Testing — How was this tested? Commands to run, expected output. (bullet points)
### Before/After — Concrete numbers if applicable (test count, coverage, etc.)`),
        images: z.array(z.object({
          path: z.string().describe('Path relative to repo root (e.g. "screenshots/dashboard.png")'),
          caption: z.string().describe('Image caption'),
        })).optional().describe('Screenshots to embed in the PR body'),
      }),
      execute: async ({ branch, title, description, images }) => {
        const repo = state.companyConfig.repo;

        // Find the worktree for this branch and commit all changes there
        const session = [...state.sessions.values()].find((s) => s.branch === branch);
        const worktreeDir = session?.worktreePath ?? repo;

        // Copy referenced images into the worktree (VP may have saved them at repo root)
        if (images) {
          for (const img of images) {
            const repoPath = path.join(repo, img.path);
            const wtPath = path.join(worktreeDir, img.path);
            if (existsSync(repoPath) && !existsSync(wtPath)) {
              mkdirSync(path.dirname(wtPath), { recursive: true });
              copyFileSync(repoPath, wtPath);
              state.log(`[tool:open_pr] Copied ${img.path} into worktree`);
            }
          }
        }

        try {
          execSync('git add -A', { cwd: worktreeDir, encoding: 'utf-8', stdio: 'pipe' });
          execSync(`git commit -m "${title}"`, { cwd: worktreeDir, encoding: 'utf-8', stdio: 'pipe' });
          state.log(`[tool:open_pr] Committed changes in ${worktreeDir}`);
        } catch {
          state.log(`[tool:open_pr] Nothing to commit in ${worktreeDir}`);
        }

        // Push the branch
        execSync(`git push -u origin "${branch}"`, { cwd: worktreeDir, encoding: 'utf-8', stdio: 'pipe' });

        // Get GitHub repo slug (owner/repo)
        const remoteUrl = execSync('gh repo view --json nameWithOwner -q .nameWithOwner', {
          cwd: repo, encoding: 'utf-8', stdio: 'pipe',
        }).trim();

        // Build body with embedded images
        let body = `## Summary\n\n${description}`;
        if (images && images.length > 0) {
          body += '\n\n## Screenshots\n';
          for (const img of images) {
            const rawUrl = `https://raw.githubusercontent.com/${remoteUrl}/${branch}/${img.path}`;
            body += `\n### ${img.caption}\n![${img.caption}](${rawUrl})\n`;
          }
        }
        body += '\n\n---\n*Generated by Agent Company VP*';

        const result = execSync(
          `gh pr create --head "${branch}" --title "${title}" --body "$(cat <<'PRBODYEOF'\n${body}\nPRBODYEOF\n)"`,
          { cwd: repo, encoding: 'utf-8', stdio: 'pipe', shell: '/bin/bash' },
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

    ask_user_feedback: tool({
      description: 'Send a WhatsApp message to the user and wait for their reply. Use when you need human input on a decision.',
      inputSchema: z.object({
        question: z.string().describe('The question to ask the user'),
        timeout_minutes: z.number().optional().describe('How long to wait for reply (default 5)'),
      }),
      execute: async ({ question, timeout_minutes }) => {
        if (!state.whatsapp) throw new Error('WhatsApp not configured. Run `vp whatsapp-login` first.');
        const jid = state.whatsapp.userJid;
        if (!jid) throw new Error('WhatsApp connected but user JID not available');

        const timeoutMs = (timeout_minutes ?? 5) * 60_000;
        const prefix = `[${state.config.name} VP]`;

        state.log(`[tool:ask_user_feedback] Sending: ${question}`);
        const reply = await state.whatsapp.sendAndWaitForReply(jid, `${prefix} ${question}`, timeoutMs);
        state.log(`[tool:ask_user_feedback] Reply: ${reply}`);
        state.tracker.logEvent('user_feedback', { question, reply });
        return `User replied: ${reply}`;
      },
    }),
  };
}
