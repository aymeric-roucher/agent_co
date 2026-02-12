import { execSync } from 'child_process';
import path from 'path';

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
}

export function createWorktree(repo: string, branch: string): string {
  const worktreeBase = path.join(repo, '..', 'worktrees');
  const worktreePath = path.join(worktreeBase, branch);
  execSync(`git worktree add -b ${branch} "${worktreePath}"`, { cwd: repo, stdio: 'pipe' });
  return worktreePath;
}

export function removeWorktree(repo: string, worktreePath: string): void {
  execSync(`git worktree remove "${worktreePath}" --force`, { cwd: repo, stdio: 'pipe' });
}

export function listWorktrees(repo: string): WorktreeInfo[] {
  const output = execSync('git worktree list --porcelain', { cwd: repo, encoding: 'utf-8' });
  const entries: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      current.path = line.slice(9);
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice(5);
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice(7).replace('refs/heads/', '');
    } else if (line === '') {
      if (current.path && current.head) {
        entries.push({
          path: current.path,
          branch: current.branch ?? '(detached)',
          head: current.head,
        });
      }
      current = {};
    }
  }

  return entries;
}
