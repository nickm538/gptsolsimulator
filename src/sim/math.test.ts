import { describe, expect, it } from "vitest";
import {
  clamp,
  damp,
  formatHeading,
  shortestAngleDegrees,
  terrainHeight,
  wrapDegrees,
  wrapRadians,
} from "./math";

describe("simulation math", () => {
  it("clamps and damps without overshoot", () => {
    expect(clamp(12, 0, 10)).toBe(10);
    expect(clamp(-2, 0, 10)).toBe(0);
    const value = damp(0, 100, 5, 1 / 60);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(100);
  });

  it("wraps aviation headings and finds the shortest turn", () => {
    expect(wrapDegrees(-10)).toBe(350);
    expect(formatHeading(359.6)).toBe("360");
    expect(shortestAngleDegrees(350, 10)).toBe(20);
    expect(shortestAngleDegrees(10, 350)).toBe(-20);
    expect(wrapRadians(Math.PI * 3)).toBeCloseTo(Math.PI, 8);
  });

  it("keeps the airport movement area flat", () => {
    expect(terrainHeight(0, 0)).toBeCloseTo(0, 6);
    expect(terrainHeight(-315, 1_310)).toBeCloseTo(0, 6);
    expect(Number.isFinite(terrainHeight(8_000, 8_000))).toBe(true);
  });
});
