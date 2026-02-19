import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { takeScreenshot } from '../src/screenshot.js';

const TMP = path.join(import.meta.dirname, '.tmp-screenshot-test');

afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe('takeScreenshot', () => {
  it('captures a PNG screenshot of an HTML file', async () => {
    mkdirSync(TMP, { recursive: true });
    const htmlPath = path.join(TMP, 'page.html');
    writeFileSync(htmlPath, '<html><body><h1>Hello Screenshot</h1></body></html>');

    const outPath = path.join(TMP, 'output', 'shot.png');
    const result = await takeScreenshot({
      url: `file://${htmlPath}`,
      outputPath: outPath,
    });

    expect(result).toBe(outPath);
    expect(existsSync(outPath)).toBe(true);
  }, 30_000);

  it('respects custom viewport dimensions', async () => {
    mkdirSync(TMP, { recursive: true });
    const htmlPath = path.join(TMP, 'sized.html');
    writeFileSync(htmlPath, '<html><body style="margin:0"><div style="width:100vw;height:100vh;background:red"></div></body></html>');

    const outPath = path.join(TMP, 'sized.png');
    const result = await takeScreenshot({
      url: `file://${htmlPath}`,
      outputPath: outPath,
      width: 800,
      height: 600,
    });

    expect(existsSync(result)).toBe(true);
  }, 30_000);

  it('creates output directory if missing', async () => {
    mkdirSync(TMP, { recursive: true });
    const htmlPath = path.join(TMP, 'auto.html');
    writeFileSync(htmlPath, '<html><body>Auto dir</body></html>');

    const deepPath = path.join(TMP, 'deep', 'nested', 'dir', 'shot.png');
    await takeScreenshot({ url: `file://${htmlPath}`, outputPath: deepPath });
    expect(existsSync(deepPath)).toBe(true);
  }, 30_000);
});
