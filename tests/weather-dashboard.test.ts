import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("weather-dashboard.html", () => {
  it("includes the required city names", () => {
    const filePath = resolve("weather-dashboard.html");
    const html = readFileSync(filePath, "utf8");

    const requiredCities = [
      "Paris",
      "Tokyo",
      "New York",
      "Sydney",
      "Nairobi",
    ];

    for (const city of requiredCities) {
      expect(html).toContain(city);
    }
  });

  it("has a responsive grid container", () => {
    const filePath = resolve("weather-dashboard.html");
    const html = readFileSync(filePath, "utf8");

    expect(html).toContain("grid-template-columns");
    expect(html).toContain("weather-grid");
  });
});
