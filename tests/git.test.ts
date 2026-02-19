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

  it('cleans up stale branch when re-creating worktree', () => {
    createWorktree(REPO, 'reuse-branch');
    // Creating the same branch again should clean up old one and succeed
    const wtPath = createWorktree(REPO, 'reuse-branch');
    expect(wtPath).toContain('reuse-branch');

    const worktrees = listWorktrees(REPO);
    const matching = worktrees.filter((w) => w.branch === 'reuse-branch');
    expect(matching).toHaveLength(1);
  });

  it('worktree path uses custom worktreeBase when provided', () => {
    const customBase = path.join(TMP, 'custom-wt');
    mkdirSync(customBase, { recursive: true });
    const wtPath = createWorktree(REPO, 'custom-base', customBase);
    expect(wtPath).toBe(path.join(customBase, 'custom-base'));
  });

  it('listWorktrees returns head SHA for each entry', () => {
    createWorktree(REPO, 'sha-check');
    const worktrees = listWorktrees(REPO);
    for (const wt of worktrees) {
      expect(wt.head).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it('removeWorktree throws for non-existent path', () => {
    expect(() => removeWorktree(REPO, '/tmp/does-not-exist-wt')).toThrow();
  });
});
