import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = process.cwd();
const cityNames = ['Paris', 'Tokyo', 'New York', 'Sydney', 'Nairobi'];

function readHtml(fileName: string): string {
  const filePath = path.join(ROOT, fileName);
  return readFileSync(filePath, 'utf8');
}

describe('weather dashboard html', () => {
  it('includes the expected cities in weather-dashboard.html', () => {
    const html = readHtml('weather-dashboard.html');
    for (const city of cityNames) {
      expect(html).toContain(city);
    }
    expect(html).toContain('Weather Dashboard');
  });

  it('includes the expected cities in index.html', () => {
    const html = readHtml('index.html');
    for (const city of cityNames) {
      expect(html).toContain(city);
    }
    expect(html).toContain('Weather Dashboard');
  });
});
