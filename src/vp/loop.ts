import { generateText, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { COMPANY_DIR, type DepartmentConfig, type CompanyConfig } from '../config.js';
import { Tracker } from '../tracker.js';
import { EventQueue } from '../event-queue.js';
import type { WorkerEvent, WorkerHandle } from '../workers/types.js';
import { createVPTools, type VPState } from './agent.js';
import { buildVPPrompt } from './prompt.js';

function readFileOrEmpty(p: string): string {
  return existsSync(p) ? readFileSync(p, 'utf-8') : '';
}

function formatWorkerEvent(event: WorkerEvent): string {
  const status = event.exitCode === 0 ? 'COMPLETED SUCCESSFULLY' : `FAILED (exit code ${event.exitCode})`;
  const output = event.output.slice(-3000);
  return `Worker ${event.workerId} ${status}.\n\nFinal output (last 3000 chars):\n${output}`;
}

export async function runVP(department: DepartmentConfig, companyConfig: CompanyConfig): Promise<never> {
  const logsBase = path.join(COMPANY_DIR, 'logs');
  const tracker = new Tracker(department.slug, logsBase);
  const eventQueue = new EventQueue<WorkerEvent>();
  const departmentDir = path.join(COMPANY_DIR, 'departments', department.slug);

  const state: VPState = {
    config: department,
    companyConfig,
    tracker,
    workers: new Map<string, WorkerHandle>(),
    eventQueue,
    departmentDir,
    companyDir: COMPANY_DIR,
  };

  const tools = createVPTools(state);
  let totalTokens = 0;
  const TOKEN_LIMIT = 150_000;

  // Load persistent knowledge for context
  const vpLogs = readFileOrEmpty(path.join(departmentDir, 'VP_LOGS.md'));
  const doc = readFileOrEmpty(path.join(departmentDir, 'DOC.md'));
  const commonDoc = readFileOrEmpty(path.join(COMPANY_DIR, 'DOC_COMMON.md'));

  const initialContext = [
    `Your responsibility: ${department.responsibility}`,
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
  console.log(`[VP:${department.slug}] Started. Responsibility: ${department.responsibility}`);

  while (true) {
    const result = await generateText({
      model: openai('gpt-4o'),
      system: buildVPPrompt(department, companyConfig),
      tools,
      messages,
      stopWhen: stepCountIs(30),
      onStepFinish: ({ toolCalls, usage }) => {
        tracker.logStep(toolCalls);
        totalTokens += (usage?.totalTokens ?? 0);
      },
    });

    // Append assistant response
    if (result.text) {
      messages.push({ role: 'assistant', content: result.text });
      console.log(`[VP:${department.slug}] ${result.text.slice(0, 200)}`);
    }

    tracker.logEvent('vp_turn_complete', { totalTokens });

    // Context limit → graceful restart
    if (totalTokens > TOKEN_LIMIT) {
      console.log(`[VP:${department.slug}] Context limit approaching (${totalTokens} tokens). Restarting...`);
      messages.push({
        role: 'user',
        content: 'CONTEXT LIMIT APPROACHING. Update VP_LOGS.md, DOC.md, and DOC_COMMON.md with everything you know. List all active workers.',
      });

      await generateText({
        model: openai('gpt-4o'),
        system: buildVPPrompt(department, companyConfig),
        tools,
        messages,
        stopWhen: stepCountIs(10),
      });

      tracker.logEvent('vp_restart', { reason: 'context_limit', totalTokens });
      return runVP(department, companyConfig);
    }

    // Trim messages if too many
    if (messages.length > 50) {
      messages.splice(1, messages.length - 20);
    }

    // Block until next worker event
    console.log(`[VP:${department.slug}] Waiting for worker events...`);
    const event = await eventQueue.dequeue();
    console.log(`[VP:${department.slug}] Worker event: ${event.workerId} exited (${event.exitCode})`);
    messages.push({ role: 'user', content: formatWorkerEvent(event) });
  }
}
