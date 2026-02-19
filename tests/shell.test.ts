import { describe, it, expect } from 'vitest';
import {
  isKnownSafeCommand,
  isMutating,
  deriveExecArgs,
  shellToExecParams,
  shellCommandToExecParams,
  runExecLike,
  execShell,
  formatShellResult,
} from '../src/vp/shell.js';
import type { ShellResult } from '../src/vp/shell.js';

describe('isKnownSafeCommand', () => {
  it.each([
    ['ls -la', true],
    ['git status', true],
    ['git diff HEAD~1', true],
    ['gh pr view 42', true],
    ['echo hello', true],
    ['cat foo.txt', true],
    ['rm -rf /', false],
    ['npm install', false],
    ['git push origin main', false],
    ['git checkout -b new', false],
    ['curl https://example.com', false],
  ])('%s → safe=%s', (cmd, expected) => {
    expect(isKnownSafeCommand(cmd)).toBe(expected);
  });

  it('recognizes safe commands wrapped in shell invocation', () => {
    expect(isKnownSafeCommand("bash -lc 'git status'")).toBe(true);
    expect(isKnownSafeCommand("zsh -c 'ls -la'")).toBe(true);
  });

  it('accepts command as array', () => {
    expect(isKnownSafeCommand(['/bin/bash', '-lc', 'git log --oneline'])).toBe(true);
    expect(isKnownSafeCommand(['/bin/bash', '-lc', 'rm file'])).toBe(false);
  });
});

describe('isMutating', () => {
  it('is inverse of isKnownSafeCommand', () => {
    expect(isMutating('ls')).toBe(false);
    expect(isMutating('rm file')).toBe(true);
  });
});

describe('deriveExecArgs', () => {
  it('uses login shell flag', () => {
    const login = deriveExecArgs('echo hello', true);
    expect(login[1]).toBe('-lc');
    expect(login[2]).toBe('echo hello');
  });

  it('uses non-login shell flag', () => {
    const noLogin = deriveExecArgs('echo hello', false);
    expect(noLogin[1]).toBe('-c');
    expect(noLogin[2]).toBe('echo hello');
  });
});

describe('shellToExecParams', () => {
  it('builds ExecParams from raw command array', () => {
    const params = shellToExecParams({ command: ['/bin/ls', '-la'] }, '/tmp');
    expect(params.command).toEqual(['/bin/ls', '-la']);
    expect(params.cwd).toBe('/tmp');
    expect(params.timeout_ms).toBe(120_000);
  });

  it('respects overrides', () => {
    const params = shellToExecParams(
      { command: ['echo'], workdir: '/home', timeout_ms: 5000, justification: 'test' },
      '/tmp',
    );
    expect(params.cwd).toBe('/home');
    expect(params.timeout_ms).toBe(5000);
    expect(params.justification).toBe('test');
  });
});

describe('shellCommandToExecParams', () => {
  it('wraps command in login shell by default', () => {
    const params = shellCommandToExecParams({ command: 'echo hi' }, '/tmp');
    expect(params.command[1]).toBe('-lc');
    expect(params.command[2]).toBe('echo hi');
  });

  it('respects login=false', () => {
    const params = shellCommandToExecParams({ command: 'echo hi', login: false }, '/tmp');
    expect(params.command[1]).toBe('-c');
  });
});

describe('runExecLike', () => {
  it('captures stdout', async () => {
    const result = await runExecLike({
      command: ['/bin/echo', 'hello world'],
      cwd: '/tmp',
      timeout_ms: 5000,
    });
    expect(result.stdout).toBe('hello world');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('captures stderr and exit code', async () => {
    const result = await runExecLike({
      command: ['/bin/bash', '-c', 'echo err >&2; exit 42'],
      cwd: '/tmp',
      timeout_ms: 5000,
    });
    expect(result.stderr).toBe('err');
    expect(result.exitCode).toBe(42);
  });

  it('kills on timeout', async () => {
    const result = await runExecLike({
      command: ['/bin/sleep', '60'],
      cwd: '/tmp',
      timeout_ms: 100,
    });
    expect(result.timedOut).toBe(true);
    expect(result.signal).toBe('SIGKILL');
  });

  it('truncates large output', async () => {
    // Generate ~50KB of output
    const result = await runExecLike({
      command: ['/bin/bash', '-c', 'python3 -c "print(\'x\' * 50000)"'],
      cwd: '/tmp',
      timeout_ms: 5000,
    });
    expect(result.stdout).toContain('[truncated:');
  });
});

describe('execShell', () => {
  it('runs command through login shell', async () => {
    const result = await execShell('echo from-shell', { cwd: '/tmp', timeout: 5000 });
    expect(result.stdout).toBe('from-shell');
    expect(result.exitCode).toBe(0);
  });
});

describe('formatShellResult', () => {
  it('formats success with output', () => {
    const result: ShellResult = { stdout: 'hello', stderr: '', exitCode: 0, signal: null, timedOut: false };
    expect(formatShellResult(result)).toBe('hello');
  });

  it('formats failure with stderr', () => {
    const result: ShellResult = { stdout: '', stderr: 'bad', exitCode: 1, signal: null, timedOut: false };
    expect(formatShellResult(result)).toBe('[exit 1]\nSTDERR:\nbad');
  });

  it('formats timeout', () => {
    const result: ShellResult = { stdout: 'partial', stderr: '', exitCode: null, signal: 'SIGKILL', timedOut: true };
    expect(formatShellResult(result)).toBe('[TIMEOUT]\npartial');
  });

  it('formats empty output', () => {
    const result: ShellResult = { stdout: '', stderr: '', exitCode: 0, signal: null, timedOut: false };
    expect(formatShellResult(result)).toBe('(no output)');
  });
});
