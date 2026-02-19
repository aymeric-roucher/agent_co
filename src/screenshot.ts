/**
 * Centralized Playwright screenshot capture.
 */
import { chromium, type Browser, type Page } from 'playwright';
import { mkdirSync } from 'fs';
import path from 'path';

export interface ScreenshotOptions {
  url: string;
  outputPath: string;
  width?: number;
  height?: number;
  fullPage?: boolean;
  timeout?: number;
}

export interface ScreenshotResult {
  outputPath: string;
  width: number;
  height: number;
  bytes: number;
}

export async function captureScreenshot(options: ScreenshotOptions): Promise<ScreenshotResult> {
  const width = options.width ?? 1280;
  const height = options.height ?? 720;
  const fullPage = options.fullPage ?? false;
  const timeout = options.timeout ?? 30_000;

  mkdirSync(path.dirname(options.outputPath), { recursive: true });

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const page: Page = await browser.newPage({ viewport: { width, height } });
    await page.goto(options.url, { waitUntil: 'networkidle', timeout });
    const buffer = await page.screenshot({ path: options.outputPath, fullPage });
    return { outputPath: options.outputPath, width, height, bytes: buffer.length };
  } finally {
    if (browser) await browser.close();
  }
}

/** Capture multiple URLs in sequence, reusing one browser instance. */
export async function captureBatch(
  items: ScreenshotOptions[],
): Promise<ScreenshotResult[]> {
  if (items.length === 0) return [];

  const browser = await chromium.launch();
  try {
    const results: ScreenshotResult[] = [];
    for (const item of items) {
      const width = item.width ?? 1280;
      const height = item.height ?? 720;
      const fullPage = item.fullPage ?? false;
      const timeout = item.timeout ?? 30_000;

      mkdirSync(path.dirname(item.outputPath), { recursive: true });
      const page = await browser.newPage({ viewport: { width, height } });
      await page.goto(item.url, { waitUntil: 'networkidle', timeout });
      const buffer = await page.screenshot({ path: item.outputPath, fullPage });
      await page.close();
      results.push({ outputPath: item.outputPath, width, height, bytes: buffer.length });
    }
    return results;
  } finally {
    await browser.close();
  }
}
