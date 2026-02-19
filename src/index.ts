#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig, ensureDepartmentDirs } from './config.js';
import { runVP } from './vp/loop.js';
import { runSecretary } from './secretary.js';
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { listWorktrees, removeWorktree } from './git.js';

function isExecError(err: unknown): err is Error & { status: number } {
  return err instanceof Error && typeof (err as Record<string, unknown>).status === 'number';
}

function discoverVPPids(slug: string): number[] {
  try {
    const output = execSync(`pgrep -f "start ${slug}"`, {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (!output) return [];
    return output.split('\n').map(l => {
      const pid = Number(l.trim());
      if (!Number.isInteger(pid) || pid <= 0) throw new Error(`Invalid PID: "${l.trim()}"`);
      return pid;
    });
  } catch (err) {
    if (isExecError(err) && err.status === 1) return [];
    if (err instanceof Error && /not found|ENOENT/i.test(err.message)) return discoverVPPidsFallback(slug);
    throw err;
  }
}

function discoverVPPidsFallback(slug: string): number[] {
  try {
    const output = execSync(`ps aux | grep "start ${slug}" | grep -v grep`, {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (!output) return [];
    return output.split('\n').map(line => {
      const pid = Number(line.trim().split(/\s+/)[1]);
      if (!Number.isInteger(pid) || pid <= 0) throw new Error(`Invalid PID from ps: "${line}"`);
      return pid;
    });
  } catch (err) {
    if (isExecError(err) && err.status === 1) return [];
    throw err;
  }
}

const program = new Command();
program.name('agents-co').description('Agent Company — agentic VP teams').version('0.1.0');

program
  .command('setup')
  .description('Run the secretary to set up the company')
  .action(async () => {
    await runSecretary();
  });

program
  .command('start <slug>')
  .description('Start a VP daemon for a department')
  .action(async (slug: string) => {
    const config = loadConfig();
    const dept = config.departments.find((d) => d.slug === slug);
    if (!dept) {
      console.error(`Department "${slug}" not found. Available: ${config.departments.map((d) => d.slug).join(', ')}`);
      process.exit(1);
    }
    ensureDepartmentDirs(config);
    await runVP(dept, config);
  });

program
  .command('list')
  .description('List all departments')
  .action(() => {
    const config = loadConfig();
    for (const dept of config.departments) {
      console.log(`  ${dept.slug} | ${dept.name} | ${dept.description.slice(0, 60)}`);
    }
  });

program
  .command('status')
  .description('Show status of all departments')
  .action(() => {
    const config = loadConfig();
    for (const dept of config.departments) {
      const workPath = path.join('company', 'workspaces', dept.slug, 'WORK.md');
      const hasWork = existsSync(workPath);
      const eventsPath = path.join('company', 'logs', dept.slug, 'events.jsonl');
      let lastEvent = '(no events)';
      if (existsSync(eventsPath)) {
        const lines = readFileSync(eventsPath, 'utf-8').trim().split('\n');
        const last = JSON.parse(lines[lines.length - 1]);
        lastEvent = `${last.type} at ${last.timestamp}`;
      }
      console.log(`  ${dept.slug} | work: ${hasWork ? 'yes' : 'no'} | last: ${lastEvent}`);
    }
  });

program
  .command('stop <slug>')
  .description('Stop a running VP daemon for a department')
  .action((slug: string) => {
    const config = loadConfig();
    const dept = config.departments.find((d) => d.slug === slug);
    if (!dept) {
      console.error(`Department "${slug}" not found. Available: ${config.departments.map((d) => d.slug).join(', ')}`);
      process.exit(1);
    }

    try {
      const pids = discoverVPPids(slug);
      if (pids.length === 0) { console.log(`No running VP found for "${slug}"`); process.exit(0); }

      for (const pid of pids) {
        try { process.kill(pid, 'SIGTERM'); } catch (err) {
          if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ESRCH') continue;
          throw err;
        }
      }
      console.log(`✓ VP stopped for "${slug}" (PIDs: ${pids.join(', ')})`);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command('logs [slug]')
  .description('Show VP or worker logs')
  .option('-f, --follow', 'Follow logs in real-time')
  .option('-n, --lines <number>', 'Number of lines to show', '50')
  .option('-w, --workers', 'Show worker logs instead of VP logs')
  .action((slug: string | undefined, options: { follow?: boolean; lines?: string; workers?: boolean }) => {
    if (options.workers) {
      const logsDir = path.join('company', 'logs', 'workers');
      if (!existsSync(logsDir)) { console.log('No worker logs yet.'); process.exit(0); }
      const files = execSync(`ls -t "${logsDir}"/*.log 2>/dev/null || true`, { encoding: 'utf-8' }).trim();
      if (!files) { console.log('No worker logs yet.'); process.exit(0); }
      const latestLog = files.split('\n')[0];
      console.log(`Showing: ${path.basename(latestLog)}\n`);
      if (options.follow) execSync(`tail -f "${latestLog}"`, { stdio: 'inherit' });
      else console.log(execSync(`tail -n ${options.lines} "${latestLog}"`, { encoding: 'utf-8' }));
    } else {
      if (!slug) { console.error('Usage: vp logs <slug>'); process.exit(1); }
      const vpLogPath = path.join('company', 'logs', slug, 'vp-output.log');
      if (!existsSync(vpLogPath)) { console.log(`No VP logs yet for "${slug}".`); process.exit(0); }
      if (options.follow) execSync(`tail -f "${vpLogPath}"`, { stdio: 'inherit' });
      else console.log(execSync(`tail -n ${options.lines} "${vpLogPath}"`, { encoding: 'utf-8' }));
    }
  });

program
  .command('reset <slug>')
  .description('Reset a department by wiping all memory')
  .option('-f, --force', 'Skip confirmation prompt')
  .action((slug: string, options: { force?: boolean }) => {
    const config = loadConfig();
    const dept = config.departments.find((d) => d.slug === slug);
    if (!dept) {
      console.error(`Department "${slug}" not found. Available: ${config.departments.map((d) => d.slug).join(', ')}`);
      process.exit(1);
    }

    const deptDir = path.join('company', 'workspaces', dept.slug);
    const logsDir = path.join('company', 'logs', dept.slug);

    const dirsToWipe = [deptDir, logsDir].filter(f => existsSync(f));
    if (dirsToWipe.length === 0) { console.log(`Nothing to reset for "${slug}".`); process.exit(0); }

    console.log(`\nWill wipe for "${slug}":\n${dirsToWipe.map(f => `  - ${f}/`).join('\n')}`);
    if (!options.force) { console.log(`\nRun with --force to confirm.`); process.exit(0); }

    for (const dir of dirsToWipe) execSync(`rm -rf "${dir}"`, { stdio: 'pipe' });

    // Clean up worktrees created by this department's workers
    const mainBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: config.repo, encoding: 'utf-8' }).trim();
    const worktrees = listWorktrees(config.repo);
    for (const wt of worktrees) {
      if (wt.branch !== mainBranch && wt.path !== config.repo) {
        try {
          removeWorktree(config.repo, wt.path);
          execSync(`git branch -D "${wt.branch}"`, { cwd: config.repo, stdio: 'pipe' });
          console.log(`  Removed worktree: ${wt.branch}`);
        } catch { /* already cleaned */ }
      }
    }

    console.log(`\n✓ Memory wiped for "${slug}". Run 'vp start ${slug}' to begin fresh.`);
  });

program.parse();
