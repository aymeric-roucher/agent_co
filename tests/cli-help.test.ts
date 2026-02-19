import { describe, it, expect } from 'vitest';
import { buildProgram } from '../src/index.js';
import type { Command } from 'commander';

function getCommand(program: Command, name: string): Command {
  const cmd = program.commands.find((c) => c.name() === name);
  if (!cmd) throw new Error(`Command "${name}" not found`);
  return cmd;
}

/** Captures the full help output including addHelpText sections. */
function getFullHelp(cmd: Command): string {
  let output = '';
  cmd.configureOutput({ writeOut: (str: string) => { output += str; } });
  cmd.outputHelp();
  return output;
}

describe('CLI help text', () => {
  const program = buildProgram();

  it('program has name "vp" and a meaningful description', () => {
    expect(program.name()).toBe('vp');
    expect(program.description()).toContain('VP daemons');
  });

  it('defines all expected commands', () => {
    const names = program.commands.map((c) => c.name()).sort();
    expect(names).toEqual(['list', 'logs', 'reset', 'setup', 'start', 'status', 'stop']);
  });

  describe('setup', () => {
    const cmd = getCommand(program, 'setup');

    it('describes the onboarding wizard', () => {
      expect(cmd.description()).toContain('onboarding');
      expect(cmd.description()).toContain('config.yaml');
    });

    it('shows an example in full help output', () => {
      expect(getFullHelp(cmd)).toContain('vp setup');
    });
  });

  describe('start', () => {
    const cmd = getCommand(program, 'start');

    it('requires a <slug> argument with description', () => {
      const help = cmd.helpInformation();
      expect(help).toContain('<slug>');
      expect(help).toContain('department identifier');
    });

    it('describes VP daemon behavior', () => {
      expect(cmd.description()).toContain('VP daemon');
      expect(cmd.description()).toContain('Claude Code workers');
    });

    it('shows examples in full help output', () => {
      expect(getFullHelp(cmd)).toContain('vp start code-quality');
    });
  });

  describe('list', () => {
    const cmd = getCommand(program, 'list');

    it('describes output contents', () => {
      expect(cmd.description()).toContain('slug');
      expect(cmd.description()).toContain('name');
      expect(cmd.description()).toContain('description');
    });
  });

  describe('status', () => {
    const cmd = getCommand(program, 'status');

    it('describes what status info is shown', () => {
      expect(cmd.description()).toContain('WORK.md');
      expect(cmd.description()).toContain('last logged event');
    });
  });

  describe('stop', () => {
    const cmd = getCommand(program, 'stop');

    it('requires a <slug> argument', () => {
      expect(cmd.helpInformation()).toContain('<slug>');
    });

    it('explains process killing', () => {
      expect(cmd.description()).toContain('killing its process');
    });
  });

  describe('logs', () => {
    const cmd = getCommand(program, 'logs');

    it('has --follow, --lines, and --workers options', () => {
      const help = cmd.helpInformation();
      expect(help).toContain('-f, --follow');
      expect(help).toContain('-n, --lines');
      expect(help).toContain('-w, --workers');
    });

    it('documents --lines default value', () => {
      expect(cmd.helpInformation()).toMatch(/default.*50/i);
    });

    it('explains --workers behavior (slug ignored)', () => {
      expect(cmd.helpInformation()).toContain('slug is ignored');
    });

    it('shows usage examples in full help output', () => {
      const help = getFullHelp(cmd);
      expect(help).toContain('vp logs code-quality -f');
      expect(help).toContain('vp logs --workers');
    });
  });

  describe('reset', () => {
    const cmd = getCommand(program, 'reset');

    it('requires a <slug> argument', () => {
      expect(cmd.helpInformation()).toContain('<slug>');
    });

    it('explains what gets wiped', () => {
      expect(cmd.description()).toContain('WORK.md');
      expect(cmd.description()).toContain('worktrees');
    });

    it('documents --force as needed to actually execute', () => {
      expect(cmd.helpInformation()).toContain('--force');
      expect(cmd.description()).toContain('Dry-run by default');
    });

    it('shows examples in full help output', () => {
      const help = getFullHelp(cmd);
      expect(help).toContain('vp reset code-quality');
      expect(help).toContain('vp reset code-quality -f');
    });
  });
});
