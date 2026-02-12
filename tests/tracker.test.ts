import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { Tracker } from '../src/tracker.js';
import path from 'path';

const TMP = path.join(import.meta.dirname, '.tmp-tracker-test');

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe('Tracker', () => {
  it('logs events as JSONL', () => {
    const tracker = new Tracker('test-dept', TMP);
    tracker.logEvent('test_event', { key: 'value' });
    tracker.logEvent('another', { n: 42 });

    const eventsPath = path.join(TMP, 'test-dept', 'events.jsonl');
    const lines = readFileSync(eventsPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]);
    expect(first.type).toBe('test_event');
    expect(first.data.key).toBe('value');
    expect(first.timestamp).toBeTruthy();
  });

  it('snapshots WORK.md', () => {
    const tracker = new Tracker('test-dept', TMP);
    const workMd = path.join(TMP, 'WORK.md');
    writeFileSync(workMd, '# Work\nSome progress');

    tracker.snapshotWorkMd(workMd);

    const snapshotsDir = path.join(TMP, 'test-dept', 'work-snapshots');
    const files = require('fs').readdirSync(snapshotsDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^WORK-.*\.md$/);
  });

  it('logStep skips empty tool calls', () => {
    const tracker = new Tracker('test-dept', TMP);
    tracker.logStep([]);

    const eventsPath = path.join(TMP, 'test-dept', 'events.jsonl');
    expect(existsSync(eventsPath)).toBe(false);
  });
});
