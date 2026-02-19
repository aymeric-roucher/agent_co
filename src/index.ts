#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig, ensureDepartmentDirs } from './config.js';
import { runVP } from './vp/loop.js';
import { runSecretary } from './secretary.js';
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { listWorktrees, removeWorktree } from './git.js';

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('vp')
    .description('Agent Company CLI — manage autonomous VP daemons that supervise Claude Code workers on git worktrees.')
    .version('0.1.0');

  program
    .command('setup')
    .description('Interactive onboarding wizard. Creates company/config.yaml with repo path, worker type, and departments.')
    .addHelpText('after', `
Examples:
  $ vp setup            # walks you through repo path, worker type, and department creation`)
    .action(async () => {
      await runSecretary();
    });

  program
    .command('start')
    .argument('<slug>', 'department identifier (e.g. "code-quality"). Use "vp list" to see available slugs.')
    .description('Start a VP daemon for a department. The VP runs in a loop, spawning and supervising Claude Code workers.')
    .addHelpText('after', `
Examples:
  $ vp start code-quality     # start the code-quality VP daemon
  $ vp start ui               # start the UI department VP`)
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
    .description('List all configured departments with their slug, name, and description.')
    .addHelpText('after', `
Output format:
  <slug> | <name> | <description>`)
    .action(() => {
      const config = loadConfig();
      for (const dept of config.departments) {
        console.log(`  ${dept.slug} | ${dept.name} | ${dept.description.slice(0, 60)}`);
      }
    });

  program
    .command('status')
    .description('Show runtime status of all departments: whether WORK.md exists and the last logged event.')
    .addHelpText('after', `
Output format:
  <slug> | work: yes/no | last: <event type> at <timestamp>`)
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
    .command('stop')
    .argument('<slug>', 'department identifier to stop')
    .description('Stop a running VP daemon by killing its process. Finds the process by matching "start <slug>" in ps output.')
    .addHelpText('after', `
Examples:
  $ vp stop code-quality      # kill the code-quality VP daemon`)
    .action((slug: string) => {
      const config = loadConfig();
      const dept = config.departments.find((d) => d.slug === slug);
      if (!dept) {
        console.error(`Department "${slug}" not found. Available: ${config.departments.map((d) => d.slug).join(', ')}`);
        process.exit(1);
      }

      try {
        const psOutput = execSync(`ps aux | grep "start ${slug}" | grep -v grep`, {
          encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();

        if (!psOutput) { console.log(`No running VP found for "${slug}"`); process.exit(0); }

        const pids = psOutput.split('\n').map(line => line.trim().split(/\s+/)[1]);
        for (const pid of pids) {
          try { execSync(`kill ${pid}`, { stdio: 'pipe' }); } catch { /* already dead */ }
        }
        console.log(`✓ VP stopped for "${slug}" (PIDs: ${pids.join(', ')})`);
      } catch (err) {
        if ((err as any).status === 1) { console.log(`No running VP found for "${slug}"`); }
        else { console.error(`Error: ${err instanceof Error ? err.message : String(err)}`); process.exit(1); }
      }
    });

  program
    .command('logs')
    .argument('[slug]', 'department identifier (required unless --workers is used)')
    .description('Tail VP or worker logs. Shows the VP log for a department by default, or the latest worker log with --workers.')
    .option('-f, --follow', 'stream new log lines as they arrive (like tail -f)')
    .option('-n, --lines <number>', 'number of lines to show (default: 50)', '50')
    .option('-w, --workers', 'show the most recent worker log instead of a VP log (slug is ignored)')
    .addHelpText('after', `
Examples:
  $ vp logs code-quality          # last 50 lines of the code-quality VP log
  $ vp logs code-quality -f       # follow the VP log in real-time
  $ vp logs code-quality -n 100   # last 100 lines
  $ vp logs --workers             # last 50 lines of the latest worker log
  $ vp logs -w -f                 # follow the latest worker log`)
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
        if (!slug) { console.error('Error: <slug> is required unless --workers is used.\n\nUsage: vp logs <slug> [-f] [-n <lines>]'); process.exit(1); }
        const vpLogPath = path.join('company', 'logs', slug, 'vp-output.log');
        if (!existsSync(vpLogPath)) { console.log(`No VP logs yet for "${slug}".`); process.exit(0); }
        if (options.follow) execSync(`tail -f "${vpLogPath}"`, { stdio: 'inherit' });
        else console.log(execSync(`tail -n ${options.lines} "${vpLogPath}"`, { encoding: 'utf-8' }));
      }
    });

  program
    .command('reset')
    .argument('<slug>', 'department identifier to reset')
    .description('Wipe a department\'s memory (WORK.md, DOC.md, VP_LOGS.md, event logs) and remove its git worktrees. Dry-run by default — pass --force to execute.')
    .option('-f, --force', 'actually delete files and worktrees (without this flag, only shows what would be deleted)')
    .addHelpText('after', `
Examples:
  $ vp reset code-quality         # preview what will be deleted
  $ vp reset code-quality -f      # actually wipe and remove worktrees`)
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

  return program;
}

// Execute when run directly (not when imported for testing)
if (process.argv[1]?.match(/index\.(ts|js)$/)) {
  buildProgram().parse();
}
