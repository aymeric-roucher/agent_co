import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { createVPTools, type VPState } from '../src/vp/agent.js';
import { Tracker } from '../src/tracker.js';
import { EventQueue } from '../src/event-queue.js';
import type { WorkerEvent, WorkerHandle } from '../src/workers/types.js';
import type { ChildProcess } from 'child_process';
import path from 'path';

const TMP = path.join(import.meta.dirname, '.tmp-vp-tools-test');
const opts = (id: string) => ({ toolCallId: id, messages: [] as [] });

function makeState(repoPath?: string): VPState {
  const companyDir = path.join(TMP, 'company');
  const departmentDir = path.join(companyDir, 'workspaces', 'test');
  mkdirSync(path.join(departmentDir, 'plans'), { recursive: true });
  mkdirSync(path.join(departmentDir, 'prds'), { recursive: true });

  return {
    config: { slug: 'test', name: 'Test', description: 'test stuff' },
    companyConfig: { repo: repoPath ?? '/tmp/fake-repo', worker_type: 'claude_code', departments: [] },
    tracker: new Tracker('test', path.join(companyDir, 'logs')),
    workers: new Map<string, WorkerHandle>(),
    eventQueue: new EventQueue<WorkerEvent>(),
    departmentDir,
    companyDir,
  };
}

function fakeWorker(id: string, branch: string, status: 'running' | 'done' | 'failed' = 'running'): WorkerHandle {
  const stdinChunks: string[] = [];
  return {
    id,
    branch,
    worktreePath: '/tmp/fake-worktree',
    process: {
      stdin: { write: (data: string) => { stdinChunks.push(data); return true; } },
      kill: () => {},
      _stdinChunks: stdinChunks,
    } as unknown as ChildProcess,
    workerType: 'claude_code',
    status,
    outputBuffer: 'line1\nline2\nsome output here',
  };
}

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe('VP tools — all 13', () => {
  // --- spawn_worker (needs real git repo) ---
  it('spawn_worker creates worktree, writes CLAUDE.md, and registers worker', async () => {
    const repo = path.join(TMP, 'repo');
    mkdirSync(repo, { recursive: true });
    execSync('git init && git commit --allow-empty -m "init"', { cwd: repo, stdio: 'pipe' });

    const state = makeState(repo);
    // Write some DOC.md so bootstrap instructions pick it up
    writeFileSync(path.join(state.departmentDir, 'DOC.md'), 'Dept knowledge');

    const tools = createVPTools(state);
    const result = await tools.spawn_worker.execute!({ task: 'do stuff', branch_name: 'feat-test' }, opts('1'));

    expect(result).toContain('spawned');
    expect(result).toContain('feat-test');
    expect(state.workers.size).toBe(1);

    const worker = [...state.workers.values()][0];
    expect(worker.branch).toBe('feat-test');
    expect(worker.status).toBe('running');

    // CLAUDE.md should exist in worktree with dept knowledge
    const claudeMd = readFileSync(path.join(worker.worktreePath, 'CLAUDE.md'), 'utf-8');
    expect(claudeMd).toContain('Dept knowledge');

    // Events log should have the spawn
    const eventsPath = path.join(state.companyDir, 'logs', 'test', 'events.jsonl');
    const events = readFileSync(eventsPath, 'utf-8');
    expect(events).toContain('worker_spawned');

    // Cleanup worktree
    worker.process.kill();
    execSync(`git worktree remove "${worker.worktreePath}" --force`, { cwd: repo, stdio: 'pipe' });
  });

  // --- check_worker ---
  it('check_worker returns status and output for known worker', async () => {
    const state = makeState();
    const tools = createVPTools(state);
    state.workers.set('w1', fakeWorker('w1', 'branch-a'));

    const result = await tools.check_worker.execute!({ worker_id: 'w1' }, opts('1'));
    expect(result).toContain('Status: running');
    expect(result).toContain('Branch: branch-a');
    expect(result).toContain('some output here');
  });

  it('check_worker returns not found for unknown id', async () => {
    const state = makeState();
    const tools = createVPTools(state);
    const result = await tools.check_worker.execute!({ worker_id: 'nope' }, opts('1'));
    expect(result).toContain('not found');
  });

  // --- send_to_worker ---
  it('send_to_worker writes to stdin of running worker', async () => {
    const state = makeState();
    const tools = createVPTools(state);
    const worker = fakeWorker('w1', 'b');
    state.workers.set('w1', worker);

    const result = await tools.send_to_worker.execute!({ worker_id: 'w1', message: 'hello' }, opts('1'));
    expect(result).toContain('Message sent');
    expect((worker.process as any)._stdinChunks).toContain('hello\n');
  });

  it('send_to_worker refuses for non-running worker', async () => {
    const state = makeState();
    const tools = createVPTools(state);
    state.workers.set('w1', fakeWorker('w1', 'b', 'done'));

    const result = await tools.send_to_worker.execute!({ worker_id: 'w1', message: 'hi' }, opts('1'));
    expect(result).toContain('is done');
  });

  it('send_to_worker returns not found for unknown id', async () => {
    const state = makeState();
    const tools = createVPTools(state);
    const result = await tools.send_to_worker.execute!({ worker_id: 'nope', message: 'hi' }, opts('1'));
    expect(result).toContain('not found');
  });

  // --- kill_worker ---
  it('kill_worker marks worker as failed and logs event', async () => {
    const state = makeState();
    const tools = createVPTools(state);
    let killed = false;
    const worker = fakeWorker('w1', 'b');
    (worker.process as any).kill = () => { killed = true; };
    state.workers.set('w1', worker);

    const result = await tools.kill_worker.execute!({ worker_id: 'w1' }, opts('1'));
    expect(result).toContain('killed');
    expect(killed).toBe(true);
    expect(worker.status).toBe('failed');

    const events = readFileSync(path.join(state.companyDir, 'logs', 'test', 'events.jsonl'), 'utf-8');
    expect(events).toContain('worker_killed');
  });

  it('kill_worker returns not found for unknown id', async () => {
    const state = makeState();
    const tools = createVPTools(state);
    const result = await tools.kill_worker.execute!({ worker_id: 'nope' }, opts('1'));
    expect(result).toContain('not found');
  });

  // --- list_workers ---
  it('list_workers returns table when workers exist', async () => {
    const state = makeState();
    const tools = createVPTools(state);
    state.workers.set('w1', fakeWorker('w1', 'branch-a'));
    state.workers.set('w2', fakeWorker('w2', 'branch-b', 'done'));

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

  // --- update_work_log ---
  it('update_work_log appends timestamped entries and snapshots', async () => {
    const state = makeState();
    const tools = createVPTools(state);
    await tools.update_work_log.execute!({ entry: 'Started task A' }, opts('1'));
    await tools.update_work_log.execute!({ entry: 'Finished task A' }, opts('2'));

    const content = readFileSync(path.join(state.departmentDir, 'WORK.md'), 'utf-8');
    expect(content).toContain('Started task A');
    expect(content).toContain('Finished task A');
    // Should have ## timestamp headers
    expect(content).toMatch(/## \d{4}-\d{2}-\d{2}/);

    // Snapshots should exist
    const snapshotsDir = path.join(state.companyDir, 'logs', 'test', 'work-snapshots');
    const snapshots = require('fs').readdirSync(snapshotsDir);
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
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

  // --- open_pr (just test it calls gh — will fail without gh, that's expected) ---
  it('open_pr throws when gh is not available or no remote', async () => {
    const repo = path.join(TMP, 'repo-pr');
    mkdirSync(repo, { recursive: true });
    execSync('git init && git commit --allow-empty -m "init"', { cwd: repo, stdio: 'pipe' });

    const state = makeState(repo);
    const tools = createVPTools(state);
    // Should throw because there's no GitHub remote
    await expect(
      tools.open_pr.execute!({ branch: 'main', title: 'test', body: 'body' }, opts('1'))
    ).rejects.toThrow();
  });
});
