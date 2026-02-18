import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const dashboardPath = 'weather-dashboard.html';
const indexPath = 'index.html';

const requiredCities = ['Paris', 'Tokyo', 'New York', 'Sydney', 'Nairobi'];
const requiredFields = ['Humidity', 'Wind', 'Sunny', 'Cloudy', 'Rainy'];

describe('weather dashboard', () => {
  it('includes the required cities and fields', () => {
    const content = readFileSync(dashboardPath, 'utf-8');
    for (const city of requiredCities) {
      expect(content).toContain(city);
    }
    for (const field of requiredFields) {
      expect(content).toContain(field);
    }
  });

  it('keeps index.html identical to weather-dashboard.html', () => {
    const dashboard = readFileSync(dashboardPath, 'utf-8');
    const index = readFileSync(indexPath, 'utf-8');
    expect(index).toBe(dashboard);
  });
});
