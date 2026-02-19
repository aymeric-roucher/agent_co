import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeCodeClient } from './claude-code-client.js';

// We mock the SDK's query function to control canUseTool flow
const mockClose = vi.fn();
let mockCanUseTool: Function;
let mockMessages: any[];
let mockResolveGenerator: Function;

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(({ prompt, options }: any) => {
    mockCanUseTool = options.canUseTool;
    // Return an async generator that yields mockMessages then waits
    const gen = (async function* () {
      for (const msg of mockMessages) {
        yield msg;
      }
      // Wait for external resolution (simulates ongoing session)
      await new Promise<void>((resolve) => { mockResolveGenerator = resolve; });
    })();
    (gen as any).close = mockClose;
    return gen;
  }),
}));

vi.mock('crypto', () => ({ randomUUID: () => 'test-uuid-1234' }));

describe('ClaudeCodeClient (Agent SDK)', () => {
  let client: ClaudeCodeClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessages = [];
    client = new ClaudeCodeClient(() => {});
  });

  it('startSession blocks until canUseTool fires and returns permission request', async () => {
    mockMessages = [
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Let me read the file.' }] }, uuid: '1', session_id: 's' },
    ];

    const startPromise = client.startSession('build widget', '/tmp/work');

    // Give the generator time to process messages
    await new Promise((r) => setTimeout(r, 50));

    // Simulate canUseTool being called (the SDK calls it internally)
    const permissionPromise = mockCanUseTool('Read', { file_path: '/tmp/work/index.ts' }, {
      signal: new AbortController().signal,
      toolUseID: 'tu-1',
    });

    const result = await startPromise;
    expect(result.threadId).toBe('test-uuid-1234');
    expect(result.content).toContain('Let me read the file.');
    expect(result.content).toContain('Permission Request: Read');
    expect(result.content).toContain('index.ts');

    // Permission is still pending (not resolved)
    expect(permissionPromise).toBeInstanceOf(Promise);
  });

  it('continueSession with approve resolves pending permission and waits for next block', async () => {
    mockMessages = [];

    const startPromise = client.startSession('task', '/tmp');
    await new Promise((r) => setTimeout(r, 50));

    // First permission request
    const perm1 = mockCanUseTool('Edit', { file_path: '/tmp/a.ts', old_string: 'x', new_string: 'y' }, {
      signal: new AbortController().signal,
      toolUseID: 'tu-1',
    });

    const { threadId } = await startPromise;

    // VP approves
    const continuePromise = client.continueSession(threadId, true);

    // After approval, the SDK would continue and hit another tool use
    const perm1Result = await perm1;
    expect(perm1Result.behavior).toBe('allow');

    // Simulate next permission request
    await new Promise((r) => setTimeout(r, 20));
    mockCanUseTool('Bash', { command: 'npm test' }, {
      signal: new AbortController().signal,
      toolUseID: 'tu-2',
    });

    const result = await continuePromise;
    expect(result.content).toContain('Permission Request: Bash');
    expect(result.content).toContain('npm test');
  });

  it('continueSession with deny sends denial message', async () => {
    mockMessages = [];

    const startPromise = client.startSession('task', '/tmp');
    await new Promise((r) => setTimeout(r, 50));

    const perm = mockCanUseTool('Bash', { command: 'rm -rf /' }, {
      signal: new AbortController().signal,
      toolUseID: 'tu-1',
    });

    const { threadId } = await startPromise;
    const continuePromise = client.continueSession(threadId, false, 'Too dangerous');

    const permResult = await perm;
    expect(permResult.behavior).toBe('deny');
    expect(permResult.message).toBe('Too dangerous');

    // Claude Code adjusts and tries another tool
    await new Promise((r) => setTimeout(r, 20));
    mockCanUseTool('Read', { file_path: '/tmp/safe.txt' }, {
      signal: new AbortController().signal,
      toolUseID: 'tu-2',
    });

    const result = await continuePromise;
    expect(result.content).toContain('Permission Request: Read');
  });

  it('throws when continueSession called with no pending permission', async () => {
    await expect(
      client.continueSession('nonexistent', true)
    ).rejects.toThrow('not found');
  });

  it('killSession closes the query handle', async () => {
    mockMessages = [];

    const startPromise = client.startSession('task', '/tmp');
    await new Promise((r) => setTimeout(r, 50));
    mockCanUseTool('Read', { file_path: '/tmp/a' }, {
      signal: new AbortController().signal,
      toolUseID: 'tu-1',
    });

    const { threadId } = await startPromise;
    client.killSession(threadId);
    expect(mockClose).toHaveBeenCalled();
  });

  it('strips CLAUDECODE from env', async () => {
    const { query: mockQuery } = await import('@anthropic-ai/claude-agent-sdk');
    process.env.CLAUDECODE = '1';
    mockMessages = [];

    const startPromise = client.startSession('task', '/tmp');
    await new Promise((r) => setTimeout(r, 50));
    mockCanUseTool('Read', { file_path: '/tmp/a' }, {
      signal: new AbortController().signal,
      toolUseID: 'tu-1',
    });
    await startPromise;

    const callOptions = vi.mocked(mockQuery).mock.calls[0][0].options!;
    expect(callOptions.env!.CLAUDECODE).toBeUndefined();
    delete process.env.CLAUDECODE;
  });
});
