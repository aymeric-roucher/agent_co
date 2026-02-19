import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { captureScreenshot, captureBatch } from '../src/screenshot.js';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';

let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), `screenshot-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeHtml(name: string, body: string): string {
  const filePath = path.join(tmpDir, name);
  writeFileSync(filePath, `<!DOCTYPE html><html><body>${body}</body></html>`);
  return `file://${filePath}`;
}

describe('captureScreenshot', () => {
  it('captures a local HTML file to png', async () => {
    const url = writeHtml('simple.html', '<h1>Hello</h1>');
    const outputPath = path.join(tmpDir, 'out', 'simple.png');

    const result = await captureScreenshot({ url, outputPath });

    expect(result.outputPath).toBe(outputPath);
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
    expect(result.bytes).toBeGreaterThan(0);
    expect(existsSync(outputPath)).toBe(true);

    // Verify it's actually a PNG (magic bytes)
    const buf = readFileSync(outputPath);
    expect(buf[0]).toBe(0x89);
    expect(buf.slice(1, 4).toString()).toBe('PNG');
  });

  it('respects custom viewport dimensions', async () => {
    const url = writeHtml('sized.html', '<p>Viewport test</p>');
    const outputPath = path.join(tmpDir, 'sized.png');

    const result = await captureScreenshot({ url, outputPath, width: 800, height: 600 });

    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    expect(result.bytes).toBeGreaterThan(0);
  });

  it('creates output directories automatically', async () => {
    const url = writeHtml('nested.html', '<p>Nested</p>');
    const outputPath = path.join(tmpDir, 'deep', 'nested', 'dir', 'shot.png');

    const result = await captureScreenshot({ url, outputPath });

    expect(existsSync(outputPath)).toBe(true);
    expect(result.bytes).toBeGreaterThan(0);
  });

  it('throws on unreachable URL', async () => {
    const outputPath = path.join(tmpDir, 'fail.png');
    await expect(
      captureScreenshot({ url: 'file:///nonexistent-path.html', outputPath, timeout: 3000 }),
    ).rejects.toThrow();
  });
});

describe('captureBatch', () => {
  it('returns empty array for empty input', async () => {
    const results = await captureBatch([]);
    expect(results).toEqual([]);
  });

  it('captures multiple pages in sequence', async () => {
    const urls = ['a', 'b', 'c'].map((name) => ({
      url: writeHtml(`${name}.html`, `<h1>${name.toUpperCase()}</h1>`),
      outputPath: path.join(tmpDir, `${name}.png`),
    }));

    const results = await captureBatch(urls);

    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.bytes).toBeGreaterThan(0);
      expect(existsSync(r.outputPath)).toBe(true);
    }
  });
});
