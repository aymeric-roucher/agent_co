import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("weather dashboard", () => {
  it("includes the five city cards", () => {
    const filePath = resolve(process.cwd(), "weather-dashboard.html");
    const html = readFileSync(filePath, "utf8");

    expect(html).toContain("Weather Dashboard");
    expect(html).toContain("Paris");
    expect(html).toContain("Tokyo");
    expect(html).toContain("New York");
    expect(html).toContain("Sydney");
    expect(html).toContain("Nairobi");
  });
});
