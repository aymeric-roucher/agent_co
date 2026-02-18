import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const cityNames = ["Paris", "Tokyo", "New York", "Sydney", "Nairobi"];
const requiredSections = ["Weather Dashboard", "Humidity", "Wind"];

async function readHtml(path: string) {
  return readFile(path, "utf8");
}

describe("weather dashboard html", () => {
  it("includes all cities and key sections", async () => {
    const html = await readHtml("weather-dashboard.html");

    for (const name of cityNames) {
      expect(html).toContain(name);
    }

    for (const section of requiredSections) {
      expect(html).toContain(section);
    }
  });

  it("keeps index.html in sync", async () => {
    const [dashboard, index] = await Promise.all([
      readHtml("weather-dashboard.html"),
      readHtml("index.html"),
    ]);

    expect(index).toBe(dashboard);
  });
});
