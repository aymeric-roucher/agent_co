import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../weather-dashboard.html", import.meta.url), "utf-8");

describe("weather-dashboard.html", () => {
  it("includes all required cities", () => {
    ["Paris", "Tokyo", "New York", "Sydney", "Nairobi"].forEach((city) => {
      expect(html).toContain(city);
    });
  });

  it("includes basic weather fields", () => {
    ["Humidity", "Wind", "Sunny", "Cloudy", "Rainy"].forEach((label) => {
      expect(html).toContain(label);
    });
  });
});
