import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('weather dashboard HTML', () => {
  it('includes the expected cities and metrics', () => {
    const filePath = path.resolve(process.cwd(), 'weather-dashboard.html');
    const html = readFileSync(filePath, 'utf-8');

    const cities = ['Paris', 'Tokyo', 'New York', 'Sydney', 'Nairobi'];
    for (const city of cities) {
      expect(html).toContain(city);
    }

    const conditions = ['Sunny', 'Cloudy', 'Rainy'];
    for (const condition of conditions) {
      expect(html).toContain(condition);
    }

    expect(html).toContain('Humidity');
    expect(html).toContain('Wind');
    expect(html).toContain('data-updated');
    expect(html).toContain('<script>');
  });
});
