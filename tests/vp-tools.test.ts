import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { createVPTools, type VPState } from '../src/vp/agent.js';
import { Tracker } from '../src/tracker.js';
import type { WorkerSession } from '../src/workers/types.js';
import type { ClaudeCodeClient } from '../src/workers/claude-code-client.js';

const TMP = path.join(import.meta.dirname, '.tmp-vp-tools-test');
const opts = (id: string) => ({ toolCallId: id, messages: [] as [] });

function fakeMCPClient(): ClaudeCodeClient {
  return {
    startSession: vi.fn().mockResolvedValue({ threadId: 'thread-abc', content: 'Worker started working' }),
    continueSession: vi.fn().mockResolvedValue({ threadId: 'thread-abc', content: 'Worker continued working' }),
    killSession: vi.fn(),
  } as unknown as ClaudeCodeClient;
}

function makeState(): VPState {
  const companyDir = path.join(TMP, 'company');
  const departmentDir = path.join(companyDir, 'workspaces', 'test');
  mkdirSync(path.join(departmentDir, 'plans'), { recursive: true });
  mkdirSync(path.join(departmentDir, 'prds'), { recursive: true });

  return {
    config: { slug: 'test', name: 'Test', description: 'test stuff' },
    companyConfig: { repo: '/tmp/fake-repo', worker_type: 'codex', departments: [] },
    tracker: new Tracker('test', path.join(companyDir, 'logs')),
    mcpClient: fakeMCPClient(),
    sessions: new Map<string, WorkerSession>(),
    done: false,
    departmentDir,
    companyDir,
    log: () => {},
    pendingImages: [],
  };
}

function fakeSession(id: string, branch: string, status: 'active' | 'done' = 'active'): WorkerSession {
  return { id, branch, worktreePath: '/tmp/fake-worktree', threadId: 'thread-abc', status };
}

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe('VP tools', () => {
  // --- continue_worker ---
  it('continue_worker calls continueSession with approve and returns response', async () => {
    const state = makeState();
    const tools = createVPTools(state);
    state.sessions.set('w1', fakeSession('w1', 'branch-a'));

    const result = await tools.continue_worker.execute!({ worker_id: 'w1', approve: true }, opts('1'));
    expect(result).toContain('Worker w1 response');
    expect(result).toContain('Worker continued working');
    expect(state.mcpClient.continueSession).toHaveBeenCalledWith('thread-abc', true, undefined);
  });

  it('continue_worker passes denial reason', async () => {
    const state = makeState();
    const tools = createVPTools(state);
    state.sessions.set('w1', fakeSession('w1', 'branch-a'));

    await tools.continue_worker.execute!({ worker_id: 'w1', approve: false, denial_reason: 'bad approach' }, opts('1'));
    expect(state.mcpClient.continueSession).toHaveBeenCalledWith('thread-abc', false, 'bad approach');
  });

  it('continue_worker returns not found for unknown id', async () => {
    const state = makeState();
    const tools = createVPTools(state);
    const result = await tools.continue_worker.execute!({ worker_id: 'nope', approve: true }, opts('1'));
    expect(result).toContain('not found');
  });

  it('continue_worker refuses for done worker', async () => {
    const state = makeState();
    const tools = createVPTools(state);
    state.sessions.set('w1', fakeSession('w1', 'b', 'done'));
    const result = await tools.continue_worker.execute!({ worker_id: 'w1', approve: true }, opts('1'));
    expect(result).toContain('is done');
  });

  // --- kill_worker ---
  it('kill_worker marks session as done and logs event', async () => {
    const state = makeState();
    const tools = createVPTools(state);
    state.sessions.set('w1', fakeSession('w1', 'b'));

    const result = await tools.kill_worker.execute!({ worker_id: 'w1' }, opts('1'));
    expect(result).toContain('killed');
    expect(state.sessions.get('w1')!.status).toBe('done');

    const events = readFileSync(path.join(state.companyDir, 'logs', 'test', 'events.jsonl'), 'utf-8');
    expect(events).toContain('worker_killed');
  });

  it('kill_worker returns not found for unknown id', async () => {
    const state = makeState();
    const tools = createVPTools(state);
    const result = await tools.kill_worker.execute!({ worker_id: 'nope' }, opts('1'));
    expect(result).toContain('not found');
  });

  it('kill_worker calls killSession on client', async () => {
    const state = makeState();
    const tools = createVPTools(state);
    state.sessions.set('w1', fakeSession('w1', 'b'));
    await tools.kill_worker.execute!({ worker_id: 'w1' }, opts('1'));
    expect(state.mcpClient.killSession).toHaveBeenCalledWith('thread-abc');
  });

  // --- list_workers ---
  it('list_workers returns table when sessions exist', async () => {
    const state = makeState();
    const tools = createVPTools(state);
    state.sessions.set('w1', fakeSession('w1', 'branch-a'));
    state.sessions.set('w2', fakeSession('w2', 'branch-b', 'done'));

    const result = await tools.list_workers.execute!({}, opts('1'));
    expect(result).toContain('w1');
    expect(result).toContain('branch-a');
    expect(result).toContain('w2');
    expect(result).toContain('done');
  });

  it('list_workers returns no workers when empty', async () => {
    const state = makeState();
    const tools = createVPTools(state);
    const result = await tools.list_workers.execute!({}, opts('1'));
    expect(result).toBe('No workers');
  });

  it('list_workers includes thread id', async () => {
    const state = makeState();
    const tools = createVPTools(state);
    state.sessions.set('w1', fakeSession('w1', 'b'));
    const result = await tools.list_workers.execute!({}, opts('1'));
    expect(result).toContain('thread:thread-abc');
  });

  // --- mark_done ---
  it('mark_done sets done flag and logs event', async () => {
    const state = makeState();
    const tools = createVPTools(state);
    const result = await tools.mark_done.execute!({ summary: 'All done' }, opts('1'));
    expect(result).toContain('done');
    expect(state.done).toBe(true);

    const events = readFileSync(path.join(state.companyDir, 'logs', 'test', 'events.jsonl'), 'utf-8');
    expect(events).toContain('vp_done');
  });

  it('mark_done includes summary in response', async () => {
    const state = makeState();
    const tools = createVPTools(state);
    const result = await tools.mark_done.execute!({ summary: 'Shipped feature X' }, opts('1'));
    expect(result).toContain('Shipped feature X');
  });

  // --- update_work_log ---
  it('update_work_log appends timestamped entries and snapshots', async () => {
    const state = makeState();
    const tools = createVPTools(state);
    await tools.update_work_log.execute!({ entry: 'Started task A' }, opts('1'));
    await tools.update_work_log.execute!({ entry: 'Finished task A' }, opts('2'));

    const content = readFileSync(path.join(state.departmentDir, 'WORK.md'), 'utf-8');
    expect(content).toContain('Started task A');
    expect(content).toContain('Finished task A');
    expect(content).toMatch(/## \d{4}-\d{2}-\d{2}/);
  });

  // --- write_doc ---
  it.each([
    { folder: 'plans' as const, filename: 'roadmap.md', content: '# Roadmap' },
    { folder: 'prds' as const, filename: 'feature.md', content: '# Feature PRD' },
  ])('write_doc creates $folder/$filename', async ({ folder, filename, content }) => {
    const state = makeState();
    const tools = createVPTools(state);
    await tools.write_doc.execute!({ filename, content, folder }, opts('1'));

    const written = readFileSync(path.join(state.departmentDir, folder, filename), 'utf-8');
    expect(written).toBe(content);
  });

  // --- update_vp_logs ---
  it('update_vp_logs overwrites (not appends)', async () => {
    const state = makeState();
    const tools = createVPTools(state);
    await tools.update_vp_logs.execute!({ content: 'v1' }, opts('1'));
    await tools.update_vp_logs.execute!({ content: 'v2' }, opts('2'));

    const content = readFileSync(path.join(state.departmentDir, 'VP_LOGS.md'), 'utf-8');
    expect(content).toBe('v2');
  });

  // --- update_doc / read_doc ---
  it('update_doc overwrites and read_doc reads back', async () => {
    const state = makeState();
    const tools = createVPTools(state);

    const empty = await tools.read_doc.execute!({}, opts('1'));
    expect(empty).toBe('(empty)');

    await tools.update_doc.execute!({ content: 'v1' }, opts('2'));
    await tools.update_doc.execute!({ content: 'v2 replaces v1' }, opts('3'));

    const result = await tools.read_doc.execute!({}, opts('4'));
    expect(result).toBe('v2 replaces v1');
  });

  // --- update_common_doc / read_common_doc ---
  it('update_common_doc appends and read_common_doc reads', async () => {
    const state = makeState();
    const tools = createVPTools(state);

    const empty = await tools.read_common_doc.execute!({}, opts('1'));
    expect(empty).toBe('(empty)');

    await tools.update_common_doc.execute!({ lines: 'line 1' }, opts('2'));
    await tools.update_common_doc.execute!({ lines: 'line 2' }, opts('3'));

    const result = await tools.read_common_doc.execute!({}, opts('4'));
    expect(result).toContain('line 1');
    expect(result).toContain('line 2');
  });

  // --- start_worker MAX_WORKERS limit ---
  it('start_worker throws when max workers reached', async () => {
    const state = makeState();
    const tools = createVPTools(state);

    // Fill up with 3 active sessions
    state.sessions.set('w1', fakeSession('w1', 'b1'));
    state.sessions.set('w2', fakeSession('w2', 'b2'));
    state.sessions.set('w3', fakeSession('w3', 'b3'));

    await expect(
      tools.start_worker.execute!({ task: 'new task', branch_name: 'b4' }, opts('1'))
    ).rejects.toThrow(/max 3/i);
  });

  it('start_worker allows new worker when some are done', async () => {
    const state = makeState();
    const tools = createVPTools(state);

    state.sessions.set('w1', fakeSession('w1', 'b1'));
    state.sessions.set('w2', fakeSession('w2', 'b2'));
    state.sessions.set('w3', fakeSession('w3', 'b3', 'done')); // done, not active

    // Should not throw since only 2 active
    // But it will fail on createWorktree since repo doesn't exist,
    // so we just verify the max-workers check passes by checking it doesn't
    // throw with the "max" message
    try {
      await tools.start_worker.execute!({ task: 'new task', branch_name: 'b4' }, opts('1'));
    } catch (e: any) {
      // Should fail on git, not on max workers
      expect(e.message).not.toMatch(/max 3/i);
    }
  });

  // --- shell tool ---
  it('shell returns formatted output', async () => {
    const state = makeState();
    state.companyConfig.repo = '/tmp';
    const tools = createVPTools(state);
    const result = await tools.shell.execute!({ command: 'echo hello' }, opts('1'));
    expect(result).toContain('hello');
  });
});
