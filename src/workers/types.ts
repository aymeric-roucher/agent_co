export interface WorkerSession {
  id: string;
  branch: string;
  worktreePath: string;
  threadId: string;
  status: 'active' | 'done';
}
