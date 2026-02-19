import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import path from 'path';

const CLI = path.join(import.meta.dirname, '..', 'src', 'index.ts');
const run = (args: string) =>
  execSync(`node --import=tsx/esm ${CLI} ${args}`, { encoding: 'utf-8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });

describe('CLI help text', () => {
  it('shows program name and description in root --help', () => {
    const help = run('--help');
    expect(help).toContain('vp');
    expect(help).toContain('Manage autonomous VP agents');
  });

  it('lists all commands in root --help', () => {
    const help = run('--help');
    for (const cmd of ['setup', 'start', 'list', 'status', 'stop', 'logs', 'reset']) {
      expect(help).toContain(cmd);
    }
  });

  const commandDescriptions: [string, string[]][] = [
    ['setup', ['Initialize config, departments, and .gitignore interactively']],
    ['start', ['Start a VP daemon', 'slug']],
    ['list', ['List all departments with slug, name, and description']],
    ['status', ['Show work progress and last event']],
    ['stop', ['Stop a running VP daemon', 'slug']],
    ['logs', ['Tail VP logs', '--workers', 'slug']],
    ['reset', ['Wipe workspace, logs, and worktrees', '--force', 'slug']],
  ];

  describe.each(commandDescriptions)('%s --help', (cmd, expectedStrings) => {
    it(`contains expected help text`, () => {
      const help = run(`${cmd} --help`);
      for (const s of expectedStrings) {
        expect(help).toContain(s);
      }
    });
  });

  it('logs --help describes all three options', () => {
    const help = run('logs --help');
    expect(help).toContain('-f, --follow');
    expect(help).toContain('-n, --lines');
    expect(help).toContain('-w, --workers');
  });

  it('reset --help describes --force option', () => {
    const help = run('reset --help');
    expect(help).toContain('-f, --force');
    expect(help).toContain('Skip confirmation and delete immediately');
  });
});
