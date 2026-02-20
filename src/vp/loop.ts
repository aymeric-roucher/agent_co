import { generateText, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { COMPANY_DIR, DEFAULT_MODEL, type DepartmentConfig, type CompanyConfig } from '../config.js';
import { Tracker } from '../tracker.js';
import type { WorkerSession } from '../workers/types.js';
import { ClaudeCodeClient } from '../workers/claude-code-client.js';
import { createVPTools, type VPState } from './agent.js';
import { buildVPPrompt } from './prompt.js';
import { createWhatsAppClient, type WhatsAppClient } from '../whatsapp/client.js';

function readFileOrEmpty(p: string): string {
  return existsSync(p) ? readFileSync(p, 'utf-8') : '';
}

function createLogger(slug: string, logsBase: string) {
  const logPath = path.join(logsBase, slug, 'vp-output.log');
  mkdirSync(path.dirname(logPath), { recursive: true });
  return (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    appendFileSync(logPath, line + '\n');
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const VP_TIMEOUT_MS = 10 * 60_000;

export async function runVP(department: DepartmentConfig, companyConfig: CompanyConfig): Promise<void> {
  const logsBase = path.join(COMPANY_DIR, 'logs');
  const tracker = new Tracker(department.slug, logsBase);
  const departmentDir = path.join(COMPANY_DIR, 'workspaces', department.slug);

  const log = createLogger(department.slug, logsBase);
  const startTime = Date.now();

  const mcpClient = new ClaudeCodeClient(log);
  log('Claude Code client ready');

  let whatsapp: WhatsAppClient | null = null;
  const waAuthDir = path.join(COMPANY_DIR, 'whatsapp-auth');
  if (existsSync(waAuthDir)) {
    whatsapp = await createWhatsAppClient(waAuthDir);
    await whatsapp.connect();
    log(`WhatsApp connected (user: ${whatsapp.userJid})`);
  }

  const state: VPState = {
    config: department,
    companyConfig,
    tracker,
    mcpClient,
    sessions: new Map<string, WorkerSession>(),
    done: false,
    departmentDir,
    companyDir: COMPANY_DIR,
    log,
    pendingImages: [],
    whatsapp,
  };

  const tools = createVPTools(state);
  let totalTokens = 0;
  let turnNumber = 0;
  const TOKEN_LIMIT = 150_000;

  const vpLogs = readFileOrEmpty(path.join(departmentDir, 'VP_LOGS.md'));
  const doc = readFileOrEmpty(path.join(departmentDir, 'DOC.md'));
  const commonDoc = readFileOrEmpty(path.join(COMPANY_DIR, 'DOC_COMMON.md'));

  const initialContext = [
    `Your description: ${department.description}`,
    `Worker type: ${companyConfig.worker_type}`,
    `Repo: ${companyConfig.repo}`,
    vpLogs ? `\n## Previous progress (VP_LOGS.md):\n${vpLogs}` : '',
    doc ? `\n## Department knowledge (DOC.md):\n${doc}` : '',
    commonDoc ? `\n## Shared knowledge (DOC_COMMON.md):\n${commonDoc}` : '',
  ].filter(Boolean).join('\n');

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: initialContext },
  ];

  tracker.logEvent('vp_started', { department: department.slug, totalTokens: 0 });
  log(`# VP: ${department.slug}`);
  log(`Description: ${department.description}`);

  try {
    while (!state.done) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      if (Date.now() - startTime > VP_TIMEOUT_MS) {
        log(`\n## TIMEOUT after ${elapsed}s. Shutting down.`);
        tracker.logEvent('vp_timeout', { elapsed_ms: Date.now() - startTime });
        break;
      }

      turnNumber++;
      log(`\n## Turn ${turnNumber} (${elapsed}s elapsed)`);

      let stepInTurn = 0;
      let result;
      try {
        result = await generateText({
          model: openai(DEFAULT_MODEL),
          system: buildVPPrompt(department, companyConfig),
          tools,
          messages,
          stopWhen: stepCountIs(50),
          onStepFinish: ({ toolCalls, toolResults, content, text, usage }) => {
            tracker.logStep(toolCalls);
            totalTokens += (usage?.totalTokens ?? 0);

            if (toolCalls.length > 0) {
              stepInTurn++;
              log(`\n### Step ${turnNumber}.${stepInTurn}`);
              for (const tc of toolCalls) {
                const args = 'args' in tc ? tc.args : ('input' in tc ? tc.input : {});
                log(`\n**Tool call:** \`${tc.toolName}\``);
                log(`\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\``);
              }
            }

            for (const tr of toolResults) {
              const output = (tr as { output: unknown }).output;
              const res = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
              log(`\n**Result (${(tr as { toolName: string }).toolName}):**\n${res}`);
            }

            for (const part of content) {
              if (part.type === 'tool-error') {
                const err = part as { toolName: string; error: unknown };
                log(`\n**Tool error (${err.toolName}):** ${err.error instanceof Error ? err.error.message : String(err.error)}`);
              }
            }

            if (text) {
              log(`\n**VP says:**\n${text}`);
            }
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`\n**ERROR:** ${msg}`);
        tracker.logEvent('vp_error', { error: msg });
        messages.push({ role: 'user', content: `ERROR from tool execution: ${msg}\n\nAdjust your approach and continue.` });
        continue;
      }

      // Push the full conversation history (tool calls + results + text) so next turn has context
      messages.push(...result.response.messages);

      tracker.logEvent('vp_turn_complete', { totalTokens });

      if (totalTokens > TOKEN_LIMIT) {
        log(`\n## Context limit (${totalTokens} tokens). Restarting...`);

        // Build worker summary for the save phase
        const workerLines = [...state.sessions.values()].map(
          (s) => `- Worker ${s.id} | branch: ${s.branch} | status: ${s.status} | worktree: ${s.worktreePath}`,
        );
        const workerSummary = workerLines.length > 0
          ? `\n\nActive workers:\n${workerLines.join('\n')}`
          : '\n\nNo active workers.';

        messages.push({
          role: 'user',
          content: `CONTEXT LIMIT APPROACHING. Before restart you MUST:\n1. Open PRs for any branches with completed work (use open_pr)\n2. Kill workers that are stuck or done\n3. Update VP_LOGS.md with: what was accomplished, which branches have PRs, what remains\n4. Update DOC.md and DOC_COMMON.md with learnings${workerSummary}`,
        });

        await generateText({
          model: openai(DEFAULT_MODEL),
          system: buildVPPrompt(department, companyConfig),
          tools,
          messages,
          stopWhen: stepCountIs(50),
        });

        tracker.logEvent('vp_restart', { reason: 'context_limit', totalTokens });
        return runVP(department, companyConfig);
      }

      if (messages.length > 50) {
        messages.splice(1, messages.length - 20);
      }

      if (!state.done) {
        await sleep(5000);

        // Inject any pending images as multimodal user messages so the VP can visually inspect them
        if (state.pendingImages.length > 0) {
          const parts: Array<{ type: 'text'; text: string } | { type: 'image'; image: string; mimeType: string }> = [
            { type: 'text', text: 'Here are the images you requested. Visually inspect them and continue.' },
          ];
          for (const img of state.pendingImages) {
            parts.push({ type: 'text', text: img.filePath });
            parts.push({ type: 'image', image: img.base64, mimeType: img.mimeType });
          }
          state.pendingImages = [];
          messages.push({ role: 'user', content: parts as any });
        } else {
          messages.push({ role: 'user', content: 'Continue.' });
        }
      }
    }
  } finally {
    state.whatsapp?.disconnect();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    log(`\n## Done (${elapsed}s total).`);
  }
}
