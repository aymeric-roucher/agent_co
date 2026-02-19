import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import path from 'path';

/**
 * Tests for pure helper functions extracted from secretary.ts.
 * We re-implement the logic here since the helpers are not exported.
 */

const TMP = path.join(import.meta.dirname, '.tmp-secretary-test');

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

// --- getAnswer logic (mirrors secretary.ts getAnswer) ---

function getAnswer(response: Map<string, { answers: string[] }>, id: string): { selected: string | null; notes: string } {
  const entry = response.get(id);
  if (!entry || entry.answers.length === 0) return { selected: null, notes: '' };
  let selected: string | null = null;
  let notes = '';
  for (const a of entry.answers) {
    if (a.startsWith('user_note: ')) {
      notes = a.slice('user_note: '.length);
    } else {
      selected = a;
    }
  }
  return { selected, notes };
}

describe('getAnswer', () => {
  it('returns null/empty for missing id', () => {
    const response = new Map<string, { answers: string[] }>();
    const { selected, notes } = getAnswer(response, 'missing');
    expect(selected).toBeNull();
    expect(notes).toBe('');
  });

  it('returns null/empty for empty answers', () => {
    const response = new Map([['q', { answers: [] }]]);
    const { selected, notes } = getAnswer(response, 'q');
    expect(selected).toBeNull();
    expect(notes).toBe('');
  });

  it('extracts selected answer', () => {
    const response = new Map([['q', { answers: ['Option A'] }]]);
    expect(getAnswer(response, 'q').selected).toBe('Option A');
  });

  it('extracts user notes', () => {
    const response = new Map([['q', { answers: ['user_note: my thoughts'] }]]);
    const { selected, notes } = getAnswer(response, 'q');
    expect(selected).toBeNull();
    expect(notes).toBe('my thoughts');
  });

  it('separates selected from notes when both present', () => {
    const response = new Map([['q', { answers: ['Option B', 'user_note: details here'] }]]);
    const { selected, notes } = getAnswer(response, 'q');
    expect(selected).toBe('Option B');
    expect(notes).toBe('details here');
  });
});

// --- addCompanyToGitignore logic (mirrors secretary.ts) ---

function addCompanyToGitignore(cwd: string): void {
  const gitignorePath = path.join(cwd, '.gitignore');
  const content = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf-8') : '';
  if (content.includes('company/')) return;
  const sep = content === '' || content.endsWith('\n') ? '' : '\n';
  const { appendFileSync } = require('fs');
  appendFileSync(gitignorePath, `${sep}company/\n`);
}

describe('addCompanyToGitignore', () => {
  it('creates .gitignore with company/ when none exists', () => {
    addCompanyToGitignore(TMP);
    const content = readFileSync(path.join(TMP, '.gitignore'), 'utf-8');
    expect(content).toBe('company/\n');
  });

  it('appends to existing .gitignore without trailing newline', () => {
    writeFileSync(path.join(TMP, '.gitignore'), 'node_modules/');
    addCompanyToGitignore(TMP);
    const content = readFileSync(path.join(TMP, '.gitignore'), 'utf-8');
    expect(content).toBe('node_modules/\ncompany/\n');
  });

  it('appends to existing .gitignore with trailing newline', () => {
    writeFileSync(path.join(TMP, '.gitignore'), 'node_modules/\n');
    addCompanyToGitignore(TMP);
    const content = readFileSync(path.join(TMP, '.gitignore'), 'utf-8');
    expect(content).toBe('node_modules/\ncompany/\n');
  });

  it('does not duplicate if company/ already present', () => {
    writeFileSync(path.join(TMP, '.gitignore'), 'company/\n');
    addCompanyToGitignore(TMP);
    const content = readFileSync(path.join(TMP, '.gitignore'), 'utf-8');
    expect(content).toBe('company/\n');
  });
});

// --- findAgentInstructionsPath logic (mirrors secretary.ts) ---

function findAgentInstructionsPath(workerType: 'claude_code' | 'codex', startDir: string, homeDir: string): string | null {
  const candidates = workerType === 'claude_code'
    ? ['CLAUDE.md', '.claude/CLAUDE.md']
    : ['AGENT.md'];
  let dir = startDir;
  while (true) {
    for (const candidate of candidates) {
      const p = path.join(dir, candidate);
      if (existsSync(p)) return p;
    }
    const parent = path.dirname(dir);
    if (parent === dir || dir === homeDir) break;
    dir = parent;
  }
  return null;
}

describe('findAgentInstructionsPath', () => {
  it('finds CLAUDE.md in current directory', () => {
    writeFileSync(path.join(TMP, 'CLAUDE.md'), '# instructions');
    const result = findAgentInstructionsPath('claude_code', TMP, '/');
    expect(result).toBe(path.join(TMP, 'CLAUDE.md'));
  });

  it('finds .claude/CLAUDE.md in current directory', () => {
    mkdirSync(path.join(TMP, '.claude'), { recursive: true });
    writeFileSync(path.join(TMP, '.claude', 'CLAUDE.md'), '# instructions');
    const result = findAgentInstructionsPath('claude_code', TMP, '/');
    expect(result).toBe(path.join(TMP, '.claude', 'CLAUDE.md'));
  });

  it('prefers CLAUDE.md over .claude/CLAUDE.md', () => {
    writeFileSync(path.join(TMP, 'CLAUDE.md'), 'top');
    mkdirSync(path.join(TMP, '.claude'), { recursive: true });
    writeFileSync(path.join(TMP, '.claude', 'CLAUDE.md'), 'nested');
    const result = findAgentInstructionsPath('claude_code', TMP, '/');
    expect(result).toBe(path.join(TMP, 'CLAUDE.md'));
  });

  it('finds AGENT.md for codex worker type', () => {
    writeFileSync(path.join(TMP, 'AGENT.md'), '# agent');
    const result = findAgentInstructionsPath('codex', TMP, '/');
    expect(result).toBe(path.join(TMP, 'AGENT.md'));
  });

  it('walks up to parent directory', () => {
    const child = path.join(TMP, 'child');
    mkdirSync(child, { recursive: true });
    writeFileSync(path.join(TMP, 'CLAUDE.md'), '# parent');
    const result = findAgentInstructionsPath('claude_code', child, '/');
    expect(result).toBe(path.join(TMP, 'CLAUDE.md'));
  });

  it('returns null when not found', () => {
    const result = findAgentInstructionsPath('claude_code', TMP, TMP);
    expect(result).toBeNull();
  });

  it('stops at home directory', () => {
    const child = path.join(TMP, 'deep', 'nested');
    mkdirSync(child, { recursive: true });
    // CLAUDE.md exists above TMP but home=TMP should stop search
    const result = findAgentInstructionsPath('claude_code', child, TMP);
    expect(result).toBeNull();
  });
});
