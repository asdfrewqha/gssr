import { describe, it, expect } from "vitest";

const SMAX = 5000;

function calculateScore(
  gx: number,
  gy: number,
  ax: number,
  ay: number,
  gFloor: string,
  aFloor: string,
  k = 200,
): number {
  if (gFloor !== aFloor) return 0;
  const d = Math.sqrt((gx - ax) ** 2 + (gy - ay) ** 2);
  return Math.round(SMAX * Math.exp(-(d / k)));
}

describe("calculateScore", () => {
  it("returns max score at distance 0", () => {
    expect(calculateScore(100, 200, 100, 200, "f1", "f1")).toBe(5000);
  });

  it("returns 0 on floor mismatch", () => {
    expect(calculateScore(100, 200, 100, 200, "f1", "f2")).toBe(0);
  });

  it("decreases with distance", () => {
    const close = calculateScore(0, 0, 10, 0, "f", "f");
    const far = calculateScore(0, 0, 500, 0, "f", "f");
    expect(close).toBeGreaterThan(far);
  });

  it("approaches 0 at large distances", () => {
    expect(calculateScore(0, 0, 100000, 0, "f", "f")).toBe(0);
  });
});
