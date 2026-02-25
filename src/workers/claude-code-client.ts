import { query, type Query, type PermissionResult, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'crypto';

function isAssistantWithContent(msg: SDKMessage): msg is SDKMessage & { message: { content: Array<{ type: string; text: string }> } } {
  const rec = msg as Record<string, unknown>;
  if (!('message' in msg) || typeof rec.message !== 'object' || rec.message === null) return false;
  return Array.isArray((rec.message as Record<string, unknown>).content);
}

function hasNumericCost(msg: SDKMessage): msg is SDKMessage & { total_cost_usd: number } {
  return 'total_cost_usd' in msg && typeof (msg as Record<string, unknown>).total_cost_usd === 'number';
}

function hasSubtype(msg: SDKMessage): msg is SDKMessage & { subtype: string } {
  return 'subtype' in msg && typeof (msg as Record<string, unknown>).subtype === 'string';
}

function hasSummary(msg: SDKMessage): msg is SDKMessage & { summary: string } {
  return 'summary' in msg && typeof (msg as Record<string, unknown>).summary === 'string';
}

interface PendingPermission {
  toolName: string;
  toolInput: Record<string, unknown>;
  resolve: (result: PermissionResult) => void;
}

interface ClaudeSession {
  queryHandle: Query;
  cwd: string;
  pendingPermission: PendingPermission | null;
  collectedText: string[];
  finished: boolean;
  blockQueue: string[];
  blockWaiter: ((content: string) => void) | null;
}

export class ClaudeCodeClient {
  private log: (msg: string) => void;
  private sessions = new Map<string, ClaudeSession>();

  constructor(log: (msg: string) => void = console.log) {
    this.log = log;
  }

  async startSession(prompt: string, cwd: string): Promise<{ threadId: string; content: string }> {
    const sessionId = randomUUID();
    this.log(`[claude-code] startSession cwd=${cwd} session=${sessionId}\n\n**Prompt:**\n${prompt}`);

    const env: Record<string, string | undefined> = { ...process.env };
    delete env.CLAUDECODE;

    const session: ClaudeSession = {
      queryHandle: null as unknown as Query,
      cwd,
      pendingPermission: null,
      collectedText: [],
      finished: false,
      blockQueue: [],
      blockWaiter: null,
    };

    const q = query({
      prompt,
      options: {
        cwd,
        env,
        settingSources: ['project'],
        canUseTool: async (toolName, input, options) => {
          const text = session.collectedText.join('\n');
          session.collectedText = [];
          const description = formatPermissionRequest(toolName, input, options.decisionReason);
          const content = text ? `${text}\n\n---\n\n${description}` : description;

          return new Promise<PermissionResult>((resolve) => {
            session.pendingPermission = { toolName, toolInput: input as Record<string, unknown>, resolve };
            this.pushBlock(session, content);
          });
        },
      },
    });

    session.queryHandle = q;
    this.sessions.set(sessionId, session);
    this.consumeGenerator(sessionId);

    const content = await this.waitForBlock(session);
    return { threadId: sessionId, content };
  }

  async continueSession(threadId: string, approve: boolean, message?: string): Promise<{ threadId: string; content: string }> {
    const session = this.sessions.get(threadId);
    if (!session) throw new Error(`Session ${threadId} not found`);
    if (!session.pendingPermission) throw new Error(`No pending permission for session ${threadId}`);

    const pending = session.pendingPermission;
    session.pendingPermission = null;

    this.log(`[claude-code] continueSession session=${threadId} approve=${approve} tool=${pending.toolName}`);

    if (approve) {
      pending.resolve({ behavior: 'allow', updatedInput: pending.toolInput });
    } else {
      pending.resolve({ behavior: 'deny', message: message || 'VP denied this action' });
    }

    if (session.finished && session.blockQueue.length === 0) {
      const text = session.collectedText.join('\n');
      return { threadId, content: text || '(session finished)' };
    }

    const content = await this.waitForBlock(session);
    return { threadId, content };
  }

  killSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.queryHandle.close();
    session.finished = true;
    this.sessions.delete(sessionId);
  }

  private async consumeGenerator(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      for await (const msg of session.queryHandle) {
        this.processMessage(session, msg);
      }
    } catch (err) {
      const text = session.collectedText.join('\n');
      session.collectedText = [];
      this.pushBlock(session, `${text}\n\n**ERROR:** ${err}`);
    }

    session.finished = true;
    if (session.blockWaiter) {
      const text = session.collectedText.join('\n');
      session.collectedText = [];
      this.pushBlock(session, text || '(session ended)');
    }
  }

  private processMessage(session: ClaudeSession, msg: SDKMessage): void {
    if (msg.type === 'assistant') {
      const content = (msg as any).message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text') session.collectedText.push(block.text);
        }
      }
    } else if (msg.type === 'result') {
      const text = session.collectedText.join('\n');
      session.collectedText = [];
      if ('result' in msg && typeof msg.result === 'string') {
        const cost = (msg as any).total_cost_usd;
        this.log(`[claude-code] session completed (cost: $${cost?.toFixed(4) ?? '?'})`);
        this.pushBlock(session, `${text}\n\n**DONE.** Final result:\n${msg.result}`);
      } else {
        this.pushBlock(session, `${text}\n\n**ERROR:** ${(msg as any).subtype}`);
      }
    } else if (msg.type === 'tool_use_summary') {
      session.collectedText.push(`[Tool: ${(msg as any).summary}]`);
    }
  }

  private pushBlock(session: ClaudeSession, content: string): void {
    if (session.blockWaiter) {
      const resolve = session.blockWaiter;
      session.blockWaiter = null;
      resolve(content);
    } else {
      session.blockQueue.push(content);
    }
  }

  private waitForBlock(session: ClaudeSession): Promise<string> {
    if (session.blockQueue.length > 0) {
      return Promise.resolve(session.blockQueue.shift()!);
    }
    return new Promise<string>((resolve) => {
      session.blockWaiter = resolve;
    });
  }
}

function formatPermissionRequest(toolName: string, input: Record<string, unknown>, reason?: string): string {
  const lines = [`**Permission Request: ${toolName}**`];
  if (reason) lines.push(`Reason: ${reason}`);
  lines.push('```json');
  lines.push(JSON.stringify(input, null, 2));
  lines.push('```');
  return lines.join('\n');
}
