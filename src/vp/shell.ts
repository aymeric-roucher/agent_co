/**
 * Port of shell.rs — async shell execution with safety classification.
 *
 * ShellHandler:        takes a raw command array (e.g. ["/bin/bash", "-lc", "ls"])
 * ShellCommandHandler: takes a command string, wraps it in the user's login shell
 */
import { spawn } from 'child_process';

// ── Constants ────────────────────────────────────────────────────────

const MAX_OUTPUT_BYTES = 30_000;
const DEFAULT_TIMEOUT_MS = 120_000;

// Read-only command prefixes that never mutate state (mirrors is_known_safe_command).
const SAFE_COMMAND_PREFIXES = [
  'ls', 'cat', 'head', 'tail', 'less', 'more',
  'grep', 'rg', 'ag', 'ack',
  'find', 'fd', 'which', 'where', 'type',
  'wc', 'du', 'df', 'file', 'stat',
  'echo', 'printf', 'date', 'whoami', 'pwd', 'hostname',
  'git status', 'git log', 'git diff', 'git show', 'git branch',
  'git remote', 'git tag', 'git rev-parse', 'git ls-files',
  'gh pr list', 'gh pr view', 'gh issue list', 'gh issue view',
  'gh repo view', 'gh api',
  'node --version', 'npm --version', 'npx --version',
  'python --version', 'python3 --version',
  'env', 'printenv',
];

// ── Types (mirrors ExecParams / ShellToolCallParams / ShellCommandToolCallParams) ──

export interface ExecParams {
  command: string[];
  cwd: string;
  timeout_ms: number;
  env?: Record<string, string>;
  justification?: string;
}

export interface ShellToolCallParams {
  command: string[];
  workdir?: string;
  timeout_ms?: number;
  justification?: string;
}

export interface ShellCommandToolCallParams {
  command: string;
  workdir?: string;
  timeout_ms?: number;
  login?: boolean;
  justification?: string;
}

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
}

// ── Safe command detection (mirrors is_known_safe_command / is_mutating) ──

/** Extract the actual user command from a shell invocation. */
function extractInnerCommand(command: string[] | string): string {
  if (Array.isArray(command)) {
    // ["/bin/bash", "-lc", "git status"] → "git status"
    const last = command[command.length - 1];
    const bin = command[0].split('/').pop() ?? '';
    if (['bash', 'zsh', 'sh'].includes(bin) && command.length >= 3) {
      return last.trim();
    }
    return command.join(' ').trim();
  }
  // "bash -lc 'actual command'" or "zsh -c 'actual command'"
  const m = command.match(/^(?:bash|zsh|sh)\s+(?:-\w+\s+)*['"](.+)['"]$/s);
  return m ? m[1].trim() : command.trim();
}

export function isKnownSafeCommand(command: string[] | string): boolean {
  const inner = extractInnerCommand(command);
  return SAFE_COMMAND_PREFIXES.some((prefix) => inner.startsWith(prefix));
}

export function isMutating(command: string): boolean {
  return !isKnownSafeCommand(command);
}

// ── Shell invocation (mirrors ShellCommandHandler::base_command / derive_exec_args) ──

/** Derive the argv for running `command` through the user's shell. */
export function deriveExecArgs(command: string, loginShell: boolean): string[] {
  const shell = process.env.SHELL || '/bin/bash';
  return loginShell ? [shell, '-lc', command] : [shell, '-c', command];
}

// ── Param builders (mirrors ShellHandler::to_exec_params / ShellCommandHandler::to_exec_params) ──

export function shellToExecParams(params: ShellToolCallParams, defaultCwd: string): ExecParams {
  return {
    command: params.command,
    cwd: params.workdir ?? defaultCwd,
    timeout_ms: params.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    justification: params.justification,
  };
}

export function shellCommandToExecParams(params: ShellCommandToolCallParams, defaultCwd: string): ExecParams {
  const command = deriveExecArgs(params.command, params.login ?? true);
  return {
    command,
    cwd: params.workdir ?? defaultCwd,
    timeout_ms: params.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    justification: params.justification,
  };
}

// ── Core execution (mirrors ShellHandler::run_exec_like) ──

export function runExecLike(execParams: ExecParams, extraEnv?: Record<string, string>): Promise<ShellResult> {
  const { command, cwd, timeout_ms } = execParams;

  const env: Record<string, string> | undefined = (() => {
    const layers = [process.env, execParams.env, extraEnv].filter(Boolean);
    return layers.length > 1 ? Object.assign({}, ...layers) : undefined;
  })();

  return new Promise((resolve) => {
    const [bin, ...args] = command;
    const child = spawn(bin, args, { cwd, env, stdio: 'pipe' });

    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeout_ms);

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdoutBytes < MAX_OUTPUT_BYTES) {
        const remaining = MAX_OUTPUT_BYTES - stdoutBytes;
        stdout += chunk.slice(0, remaining).toString();
      }
      stdoutBytes += chunk.length;
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrBytes < MAX_OUTPUT_BYTES) {
        const remaining = MAX_OUTPUT_BYTES - stderrBytes;
        stderr += chunk.slice(0, remaining).toString();
      }
      stderrBytes += chunk.length;
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);

      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        stdout += `\n[truncated: ${stdoutBytes} bytes total, showed first ${MAX_OUTPUT_BYTES}]`;
      }
      if (stderrBytes > MAX_OUTPUT_BYTES) {
        stderr += `\n[truncated: ${stderrBytes} bytes total, showed first ${MAX_OUTPUT_BYTES}]`;
      }

      resolve({
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        exitCode: code,
        signal,
        timedOut,
      });
    });
  });
}

// ── Convenience wrapper (high-level entry point used by the VP tool) ──

export async function execShell(command: string, options?: {
  cwd?: string;
  timeout?: number;
  login?: boolean;
  env?: Record<string, string>;
}): Promise<ShellResult> {
  const params = shellCommandToExecParams(
    { command, login: options?.login ?? true, timeout_ms: options?.timeout, workdir: options?.cwd },
    options?.cwd ?? process.cwd(),
  );
  return runExecLike(params, options?.env);
}

// ── Output formatting (mirrors ToolOutput::Function text construction) ──

export function formatShellResult(result: ShellResult): string {
  const parts: string[] = [];

  if (result.timedOut) {
    parts.push('[TIMEOUT]');
  }

  if (result.exitCode !== 0 && result.exitCode !== null) {
    parts.push(`[exit ${result.exitCode}]`);
  }

  if (result.stdout) {
    parts.push(result.stdout);
  }

  if (result.stderr) {
    parts.push(`STDERR:\n${result.stderr}`);
  }

  return parts.join('\n') || '(no output)';
}
