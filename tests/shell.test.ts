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
    ['find . -name "*.ts"', true],
    ['wc -l foo.txt', true],
    ['pwd', true],
    ['whoami', true],
    ['node --version', true],
    ['python3 --version', true],
    ['env', true],
    ['rm -rf /', false],
    ['npm install', false],
    ['git push origin main', false],
    ['git checkout -b new', false],
    ['curl https://example.com', false],
    ['mv a b', false],
    ['mkdir foo', false],
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

  it('handles array commands without shell wrapper', () => {
    expect(isKnownSafeCommand(['ls', '-la'])).toBe(true);
    expect(isKnownSafeCommand(['npm', 'install'])).toBe(false);
  });

  it('treats sh wrapper same as bash', () => {
    expect(isKnownSafeCommand(['/bin/sh', '-c', 'git status'])).toBe(true);
    expect(isKnownSafeCommand("sh -c 'echo hi'")).toBe(true);
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

  it('uses SHELL env var or falls back to /bin/bash', () => {
    const args = deriveExecArgs('ls', true);
    expect(args[0]).toMatch(/\/(bash|zsh|sh)$/);
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

  it('uses default cwd when workdir not provided', () => {
    const params = shellCommandToExecParams({ command: 'ls' }, '/default');
    expect(params.cwd).toBe('/default');
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
    const result = await runExecLike({
      command: ['/bin/bash', '-c', 'python3 -c "print(\'x\' * 50000)"'],
      cwd: '/tmp',
      timeout_ms: 5000,
    });
    expect(result.stdout).toContain('[truncated:');
  });

  it('captures both stdout and stderr', async () => {
    const result = await runExecLike({
      command: ['/bin/bash', '-c', 'echo out; echo err >&2'],
      cwd: '/tmp',
      timeout_ms: 5000,
    });
    expect(result.stdout).toBe('out');
    expect(result.stderr).toBe('err');
    expect(result.exitCode).toBe(0);
  });

  it('returns empty strings for silent command', async () => {
    const result = await runExecLike({
      command: ['/bin/bash', '-c', 'exit 0'],
      cwd: '/tmp',
      timeout_ms: 5000,
    });
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });
});

describe('execShell', () => {
  it('runs command through login shell', async () => {
    const result = await execShell('echo from-shell', { cwd: '/tmp', timeout: 5000 });
    expect(result.stdout).toBe('from-shell');
    expect(result.exitCode).toBe(0);
  });

  it('respects login=false option', async () => {
    const result = await execShell('echo no-login', { cwd: '/tmp', timeout: 5000, login: false });
    expect(result.stdout).toBe('no-login');
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

  it('formats combined stdout + stderr + exit code', () => {
    const result: ShellResult = { stdout: 'out', stderr: 'err', exitCode: 2, signal: null, timedOut: false };
    const formatted = formatShellResult(result);
    expect(formatted).toContain('[exit 2]');
    expect(formatted).toContain('out');
    expect(formatted).toContain('STDERR:\nerr');
  });

  it('timeout with stderr shows both markers', () => {
    const result: ShellResult = { stdout: '', stderr: 'panic', exitCode: null, signal: 'SIGKILL', timedOut: true };
    const formatted = formatShellResult(result);
    expect(formatted).toContain('[TIMEOUT]');
    expect(formatted).toContain('STDERR:\npanic');
  });
});
