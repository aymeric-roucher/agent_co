import { appendFileSync, mkdirSync, writeFileSync, copyFileSync } from 'fs';
import path from 'path';

export class Tracker {
  private eventsPath: string;
  private snapshotsDir: string;

  constructor(slug: string, logsBase: string) {
    const dir = path.join(logsBase, slug);
    this.snapshotsDir = path.join(dir, 'work-snapshots');
    mkdirSync(this.snapshotsDir, { recursive: true });
    this.eventsPath = path.join(dir, 'events.jsonl');
  }

  logEvent(type: string, data: Record<string, unknown>): void {
    const line = JSON.stringify({ timestamp: new Date().toISOString(), type, data });
    appendFileSync(this.eventsPath, line + '\n');
  }

  snapshotWorkMd(workMdPath: string): void {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    copyFileSync(workMdPath, path.join(this.snapshotsDir, `WORK-${ts}.md`));
  }

  logStep(toolCalls: unknown[]): void {
    if (toolCalls.length === 0) return;
    this.logEvent('agent_step', { toolCalls });
  }
}
