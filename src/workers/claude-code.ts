import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import type { WorkerHandle, WorkerEvent } from './types.js';
import type { EventQueue } from '../event-queue.js';

export function spawnClaudeCode(
  worktreePath: string,
  branch: string,
  prompt: string,
  eventQueue: EventQueue<WorkerEvent>,
): WorkerHandle {
  const id = randomUUID().slice(0, 8);
  const proc = spawn('claude', ['-p', prompt, '--dangerously-skip-permissions'], {
    cwd: worktreePath,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const handle: WorkerHandle = {
    id,
    branch,
    worktreePath,
    process: proc,
    workerType: 'claude_code',
    status: 'running',
    outputBuffer: '',
  };

  proc.stdout?.on('data', (chunk: Buffer) => {
    handle.outputBuffer += chunk.toString();
  });
  proc.stderr?.on('data', (chunk: Buffer) => {
    handle.outputBuffer += chunk.toString();
  });

  proc.on('exit', (code) => {
    handle.status = code === 0 ? 'done' : 'failed';
    eventQueue.push({ workerId: id, type: 'worker_exit', exitCode: code, output: handle.outputBuffer });
  });

  return handle;
}
