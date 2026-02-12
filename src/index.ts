#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig, ensureDepartmentDirs } from './config.js';
import { runVP } from './vp/loop.js';
import { runSecretary } from './secretary.js';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

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
      console.log(`  ${dept.slug} | ${dept.name} | ${dept.responsibility.slice(0, 60)}`);
    }
  });

program
  .command('status')
  .description('Show status of all departments')
  .action(() => {
    const config = loadConfig();
    for (const dept of config.departments) {
      const workPath = path.join('company', 'departments', dept.slug, 'WORK.md');
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

program.parse();
