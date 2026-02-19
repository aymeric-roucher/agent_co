import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import path from 'path';
import { takeScreenshot, fileUrl } from '../src/vp/screenshot.js';
import { createVPTools, type VPState } from '../src/vp/agent.js';
import { Tracker } from '../src/tracker.js';
import type { ClaudeCodeClient } from '../src/workers/claude-code-client.js';

const TMP = path.join(import.meta.dirname, '.tmp-screenshot-test');
const opts = (id: string) => ({ toolCallId: id, messages: [] as [] });

const MINIMAL_HTML = `<!DOCTYPE html>
<html><body><h1>Hello Playwright</h1></body></html>`;

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

// ── fileUrl ──

describe('fileUrl', () => {
  it.each([
    ['/tmp/test.html', 'file:///tmp/test.html'],
    ['/home/user/dashboard.html', 'file:///home/user/dashboard.html'],
  ])('converts %s → %s', (input, expected) => {
    expect(fileUrl(input)).toBe(expected);
  });
});

// ── takeScreenshot (integration — requires Playwright browsers installed) ──

describe('takeScreenshot', () => {
  it('captures a PNG from a local HTML file', async () => {
    const htmlPath = path.join(TMP, 'page.html');
    const pngPath = path.join(TMP, 'output.png');
    writeFileSync(htmlPath, MINIMAL_HTML);

    const result = await takeScreenshot(fileUrl(htmlPath), pngPath, {
      width: 800,
      height: 600,
      fullPage: false,
    });

    expect(result.outputPath).toBe(pngPath);
    expect(result.bytes).toBeGreaterThan(0);
    expect(existsSync(pngPath)).toBe(true);

    // Verify it's a valid PNG (magic bytes: 0x89 P N G)
    const buf = readFileSync(pngPath);
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50); // P
    expect(buf[2]).toBe(0x4e); // N
    expect(buf[3]).toBe(0x47); // G
  });

  it('creates output directory if missing', async () => {
    const htmlPath = path.join(TMP, 'page.html');
    const pngPath = path.join(TMP, 'nested', 'dir', 'shot.png');
    writeFileSync(htmlPath, MINIMAL_HTML);

    const result = await takeScreenshot(fileUrl(htmlPath), pngPath);
    expect(existsSync(pngPath)).toBe(true);
    expect(result.bytes).toBeGreaterThan(0);
  });

  it('respects fullPage option', async () => {
    const tallHtml = `<!DOCTYPE html><html><body>
      <div style="height:3000px;background:linear-gradient(red,blue)">tall</div>
    </body></html>`;
    const htmlPath = path.join(TMP, 'tall.html');
    writeFileSync(htmlPath, tallHtml);

    const fullPath = path.join(TMP, 'full.png');
    const clippedPath = path.join(TMP, 'clipped.png');

    const [full, clipped] = await Promise.all([
      takeScreenshot(fileUrl(htmlPath), fullPath, { fullPage: true, height: 600 }),
      takeScreenshot(fileUrl(htmlPath), clippedPath, { fullPage: false, height: 600 }),
    ]);

    // Full page screenshot should be larger than clipped viewport
    expect(full.bytes).toBeGreaterThan(clipped.bytes);
  });

  it('throws on invalid URL', async () => {
    const pngPath = path.join(TMP, 'fail.png');
    await expect(
      takeScreenshot('file:///nonexistent/page.html', pngPath, { timeout: 5000 }),
    ).rejects.toThrow();
  });
});

// ── take_screenshot VP tool ──

describe('take_screenshot VP tool', () => {
  function makeState(): VPState {
    const companyDir = path.join(TMP, 'company');
    const departmentDir = path.join(companyDir, 'workspaces', 'test');
    mkdirSync(path.join(departmentDir, 'plans'), { recursive: true });

    return {
      config: { slug: 'test', name: 'Test', description: 'test' },
      companyConfig: { repo: '/tmp/fake-repo', worker_type: 'codex', departments: [] },
      tracker: new Tracker('test', path.join(companyDir, 'logs')),
      mcpClient: { startSession: vi.fn(), continueSession: vi.fn(), killSession: vi.fn() } as unknown as ClaudeCodeClient,
      sessions: new Map(),
      done: false,
      departmentDir,
      companyDir,
      log: () => {},
      pendingImages: [],
    };
  }

  it('captures screenshot and queues image for inspection', async () => {
    const htmlPath = path.join(TMP, 'tool-test.html');
    const pngPath = path.join(TMP, 'tool-output.png');
    writeFileSync(htmlPath, MINIMAL_HTML);

    const state = makeState();
    const tools = createVPTools(state);
    const result = await tools.take_screenshot.execute!(
      { html_path: htmlPath, output_path: pngPath },
      opts('1'),
    );

    expect(result).toContain('Screenshot saved');
    expect(result).toContain('visual inspection');
    expect(existsSync(pngPath)).toBe(true);
    expect(state.pendingImages).toHaveLength(1);
    expect(state.pendingImages[0].mimeType).toBe('image/png');
    expect(state.pendingImages[0].filePath).toBe(pngPath);
  });

  it('throws when HTML file does not exist', async () => {
    const state = makeState();
    const tools = createVPTools(state);
    await expect(
      tools.take_screenshot.execute!(
        { html_path: '/nonexistent.html', output_path: path.join(TMP, 'out.png') },
        opts('1'),
      ),
    ).rejects.toThrow('HTML file not found');
  });
});
