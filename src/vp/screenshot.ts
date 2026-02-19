/**
 * Playwright screenshot capture for HTML file verification.
 */
import { chromium, type Browser, type Page } from 'playwright';
import { mkdirSync } from 'fs';
import path from 'path';

export interface ScreenshotOptions {
  width?: number;
  height?: number;
  fullPage?: boolean;
  timeout?: number;
}

const DEFAULTS: Required<ScreenshotOptions> = {
  width: 1280,
  height: 720,
  fullPage: true,
  timeout: 30_000,
};

export interface ScreenshotResult {
  outputPath: string;
  bytes: number;
}

/** Take a screenshot of a URL (file:// or http://) and save it as PNG. */
export async function takeScreenshot(
  url: string,
  outputPath: string,
  options?: ScreenshotOptions,
): Promise<ScreenshotResult> {
  // Filter out undefined so DEFAULTS aren't clobbered by explicit undefineds from Zod
  const defined = Object.fromEntries(
    Object.entries(options ?? {}).filter(([, v]) => v !== undefined),
  );
  const opts = { ...DEFAULTS, ...defined };

  mkdirSync(path.dirname(outputPath), { recursive: true });

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const page: Page = await browser.newPage({
      viewport: { width: opts.width, height: opts.height },
    });
    await page.goto(url, { waitUntil: 'networkidle', timeout: opts.timeout });
    const buf = await page.screenshot({ path: outputPath, fullPage: opts.fullPage });
    return { outputPath, bytes: buf.length };
  } finally {
    if (browser) await browser.close();
  }
}

/** Build a file:// URL from an absolute path. */
export function fileUrl(absolutePath: string): string {
  return `file://${absolutePath}`;
}
