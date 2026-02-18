import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("weather dashboard html", () => {
  it("includes required cities and fields", () => {
    const html = readFileSync("weather-dashboard.html", "utf8");
    const cities = ["Paris", "Tokyo", "New York", "Sydney", "Nairobi"];
    for (const city of cities) {
      expect(html).toContain(city);
    }
    expect(html).toContain("Humidity");
    expect(html).toContain("Wind");
    expect(html).toContain("class=\"grid\"");
  });
});
