import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("weather-dashboard.html", () => {
  it("includes the expected header", () => {
    const html = readFileSync(resolve(process.cwd(), "weather-dashboard.html"), "utf-8");
    expect(html).toContain("Global Weather Snapshot");
  });

  it("lists the five cities", () => {
    const html = readFileSync(resolve(process.cwd(), "weather-dashboard.html"), "utf-8");
    expect(html).toContain("Paris");
    expect(html).toContain("Tokyo");
    expect(html).toContain("New York");
    expect(html).toContain("Sydney");
    expect(html).toContain("Nairobi");
  });
});
