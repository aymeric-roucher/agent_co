import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdirSync, rmSync } from 'fs';
import { createWorktree, removeWorktree, listWorktrees } from '../src/git.js';
import path from 'path';

const TMP = path.join(import.meta.dirname, '.tmp-git-test');
const REPO = path.join(TMP, 'repo');

beforeEach(() => {
  mkdirSync(REPO, { recursive: true });
  execSync('git init && git commit --allow-empty -m "init"', { cwd: REPO, stdio: 'pipe' });
});

afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe('git worktrees', () => {
  it('creates and lists a worktree', () => {
    const wtPath = createWorktree(REPO, 'test-branch');
    expect(wtPath).toContain('test-branch');

    const worktrees = listWorktrees(REPO);
    const branches = worktrees.map((w) => w.branch);
    expect(branches).toContain('test-branch');
  });

  it('removes a worktree', () => {
    const wtPath = createWorktree(REPO, 'to-remove');
    removeWorktree(REPO, wtPath);

    const worktrees = listWorktrees(REPO);
    const branches = worktrees.map((w) => w.branch);
    expect(branches).not.toContain('to-remove');
  });

  it('lists main worktree', () => {
    const worktrees = listWorktrees(REPO);
    expect(worktrees.length).toBeGreaterThanOrEqual(1);
    expect(worktrees[0].head).toBeTruthy();
  });
});
