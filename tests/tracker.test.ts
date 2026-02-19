import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
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

  it('event timestamps are ISO 8601', () => {
    const tracker = new Tracker('test-dept', TMP);
    tracker.logEvent('ts_test', { x: 1 });

    const eventsPath = path.join(TMP, 'test-dept', 'events.jsonl');
    const event = JSON.parse(readFileSync(eventsPath, 'utf-8').trim());
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('snapshots WORK.md with content preserved', () => {
    const tracker = new Tracker('test-dept', TMP);
    const workMd = path.join(TMP, 'WORK.md');
    writeFileSync(workMd, '# Work\nSome progress');

    tracker.snapshotWorkMd(workMd);

    const snapshotsDir = path.join(TMP, 'test-dept', 'work-snapshots');
    const files = readdirSync(snapshotsDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^WORK-.*\.md$/);

    const content = readFileSync(path.join(snapshotsDir, files[0]), 'utf-8');
    expect(content).toBe('# Work\nSome progress');
  });

  it('snapshot filename has no colons or dots', () => {
    const tracker = new Tracker('test-dept', TMP);
    const workMd = path.join(TMP, 'WORK.md');
    writeFileSync(workMd, 'test');
    tracker.snapshotWorkMd(workMd);

    const files = readdirSync(path.join(TMP, 'test-dept', 'work-snapshots'));
    // The filename (minus the .md extension) should contain no : or .
    const stem = files[0].replace(/\.md$/, '');
    expect(stem).not.toMatch(/[:.]/);
  });

  it('logStep skips empty tool calls', () => {
    const tracker = new Tracker('test-dept', TMP);
    tracker.logStep([]);

    const eventsPath = path.join(TMP, 'test-dept', 'events.jsonl');
    expect(existsSync(eventsPath)).toBe(false);
  });

  it('logStep logs non-empty tool calls as vp_step', () => {
    const tracker = new Tracker('test-dept', TMP);
    tracker.logStep([{ toolName: 'shell', args: { command: 'ls' } }]);

    const eventsPath = path.join(TMP, 'test-dept', 'events.jsonl');
    const event = JSON.parse(readFileSync(eventsPath, 'utf-8').trim());
    expect(event.type).toBe('vp_step');
    expect(event.data.toolCalls).toHaveLength(1);
  });

  it('constructor creates snapshots directory', () => {
    new Tracker('fresh-dept', TMP);
    expect(existsSync(path.join(TMP, 'fresh-dept', 'work-snapshots'))).toBe(true);
  });
});
