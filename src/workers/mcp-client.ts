import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const MCP_TIMEOUT_MS = 3 * 60_000;

export class CodexMCPClient {
  private client!: Client;
  private transport!: StdioClientTransport;
  private model: string;
  private log: (msg: string) => void;

  constructor(model = 'gpt-5-mini', log: (msg: string) => void = console.log) {
    this.model = model;
    this.log = log;
  }

  async connect(): Promise<void> {
    this.transport = new StdioClientTransport({
      command: 'codex',
      args: ['mcp-server', '-c', `model="${this.model}"`],
    });
    this.client = new Client({ name: 'agents-co-vp', version: '0.1.0' });
    await this.client.connect(this.transport);
  }

  async startSession(prompt: string, cwd: string): Promise<{ threadId: string; content: string }> {
    this.log(`[mcp] startSession cwd=${cwd}\n\n**Prompt:**\n${prompt}`);
    const t0 = Date.now();
    const result = await this.client.callTool(
      { name: 'codex', arguments: { prompt, cwd, 'approval-policy': 'never', sandbox: 'workspace-write' } },
      undefined,
      { timeout: MCP_TIMEOUT_MS },
    );
    this.log(`[mcp] startSession returned in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return this.parseResult(result);
  }

  async continueSession(threadId: string, prompt: string): Promise<{ threadId: string; content: string }> {
    this.log(`[mcp] continueSession threadId=${threadId}\n\n**Prompt:**\n${prompt}`);
    const t0 = Date.now();
    const result = await this.client.callTool(
      { name: 'codex-reply', arguments: { threadId, prompt } },
      undefined,
      { timeout: MCP_TIMEOUT_MS },
    );
    this.log(`[mcp] continueSession returned in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return this.parseResult(result);
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  private parseResult(result: Awaited<ReturnType<Client['callTool']>>): { threadId: string; content: string } {
    const content = (result.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');

    const threadId = (result as Record<string, unknown>)['threadId'] as string
      ?? (result.structuredContent as Record<string, unknown>)?.['threadId'] as string
      ?? extractThreadId(content);

    return { threadId, content };
  }
}

function extractThreadId(text: string): string {
  const match = text.match(/threadId[:\s]+"?([a-zA-Z0-9_-]+)"?/);
  if (match) return match[1];
  throw new Error('Could not extract threadId from Codex MCP response');
}
