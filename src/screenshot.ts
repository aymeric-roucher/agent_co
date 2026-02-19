import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import path from 'path';

export interface ScreenshotOptions {
  url: string;
  outputPath: string;
  width?: number;
  height?: number;
  fullPage?: boolean;
}

/** Capture a screenshot of a URL using Playwright's Chromium. */
export async function takeScreenshot(opts: ScreenshotOptions): Promise<string> {
  mkdirSync(path.dirname(opts.outputPath), { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: opts.width ?? 1280, height: opts.height ?? 720 },
  });

  await page.goto(opts.url, { waitUntil: 'networkidle' });
  await page.screenshot({ path: opts.outputPath, fullPage: opts.fullPage ?? false });
  await browser.close();

  return opts.outputPath;
}
