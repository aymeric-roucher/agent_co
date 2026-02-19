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

  it('logStep writes vp_step event for non-empty tool calls', () => {
    const tracker = new Tracker('test-dept', TMP);
    const toolCalls = [
      { name: 'shell', args: { command: 'ls' } },
      { name: 'read_file', args: { file_path: '/tmp/x' } },
    ];
    tracker.logStep(toolCalls);

    const eventsPath = path.join(TMP, 'test-dept', 'events.jsonl');
    const lines = readFileSync(eventsPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);

    const event = JSON.parse(lines[0]);
    expect(event.type).toBe('vp_step');
    expect(event.data.toolCalls).toEqual(toolCalls);
  });

  it('logEvent produces valid JSON with ISO timestamps', () => {
    const tracker = new Tracker('test-dept', TMP);
    tracker.logEvent('custom_event', { hello: 'world', count: 3 });

    const eventsPath = path.join(TMP, 'test-dept', 'events.jsonl');
    const parsed = JSON.parse(readFileSync(eventsPath, 'utf-8').trim());
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parsed.data.hello).toBe('world');
    expect(parsed.data.count).toBe(3);
  });
});
