import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');

const readHtml = (name: string) =>
  readFileSync(path.join(ROOT, name), 'utf-8');

describe('weather dashboard html', () => {
  it('includes the five cities and key fields', () => {
    const html = readHtml('weather-dashboard.html');
    const cities = ['Paris', 'Tokyo', 'New York', 'Sydney', 'Nairobi'];

    cities.forEach((city) => {
      expect(html).toContain(city);
    });

    expect(html).toContain('Humidity');
    expect(html).toContain('Wind');
    expect(html).toContain('Weather Dashboard');
  });

  it('keeps index.html in sync', () => {
    const dashboard = readHtml('weather-dashboard.html');
    const index = readHtml('index.html');

    expect(index).toBe(dashboard);
  });
});
