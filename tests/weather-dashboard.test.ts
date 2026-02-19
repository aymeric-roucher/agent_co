import { readFileSync } from "fs";
import { describe, it, expect } from "vitest";

const root = new URL("..", import.meta.url).pathname;
const dashboard = readFileSync(`${root}/weather-dashboard.html`, "utf-8");
const index = readFileSync(`${root}/index.html`, "utf-8");

describe("weather dashboard", () => {
  it.each(["Paris", "15°C", "Cloudy"])("contains %s", (text) => {
    expect(dashboard).toContain(text);
  });

  it("index.html is identical to weather-dashboard.html", () => {
    expect(index).toBe(dashboard);
  });
});
