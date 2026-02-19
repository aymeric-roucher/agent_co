import type { ChildProcess } from 'child_process';

export type WorkerType = 'codex' | 'claude_code';
export type WorkerStatus = 'running' | 'done' | 'failed';

export interface WorkerHandle {
  id: string;
  branch: string;
  worktreePath: string;
  process: ChildProcess;
  workerType: WorkerType;
  status: WorkerStatus;
  outputBuffer: string;
}

export interface WorkerEvent {
  workerId: string;
  type: 'worker_exit';
  exitCode: number | null;
  output: string;
}

export interface WorkerSession {
  id: string;
  branch: string;
  worktreePath: string;
  threadId: string;
  status: 'active' | 'done';
}
