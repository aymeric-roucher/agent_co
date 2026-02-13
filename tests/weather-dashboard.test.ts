import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const DASHBOARD_PATH = path.resolve(import.meta.dirname, '..', 'weather-dashboard.html');

describe('weather dashboard', () => {
  it('exists and contains key content', () => {
    const html = readFileSync(DASHBOARD_PATH, 'utf-8');
    expect(html).toContain('<title>Weather Dashboard</title>');

    const cities = ['Paris', 'Tokyo', 'New York', 'Sydney', 'Nairobi'];
    for (const city of cities) {
      expect(html).toContain(city);
    }
  });
});
