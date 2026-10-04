import { it, expect } from "vitest";
import { evaluateCurve, type Curve } from "@autospine/motion";
import { readFileSync } from "node:fs";

const curves: Curve[] = [
  { type: "linear" },
  { type: "stepped" },
  { type: "ease" },
  { type: "bezier", x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
  { type: "overshoot", amount: 1.5 },
];
for (const curve of curves)
  it("Gate 9 endpoints and finite values: " + curve.type, () => {
    expect(evaluateCurve(curve, 0)).toBe(0);
    expect(evaluateCurve(curve, 1)).toBe(1);
    for (let i = 0; i <= 100; i++)
      expect(Number.isFinite(evaluateCurve(curve, i / 100))).toBe(true);
  });
it("Gate 9 continuous non-overshoot curves are monotonic, Bezier inverts its x coordinate", () => {
  for (const curve of curves.slice(0, 4)) {
    const values = Array.from({ length: 1001 }, (_, i) => evaluateCurve(curve, i / 1000));
    for (let i = 1; i < values.length; i++)
      expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]! - 1e-12);
  }
  expect(
    evaluateCurve({ type: "bezier", x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.75 }, 0.3),
  ).toBeCloseTo(0.3, 12);
  expect(evaluateCurve(curves[3]!, 0.5)).toBeCloseTo(0.5, 12);
  expect(evaluateCurve({ type: "overshoot", amount: 1.5 }, 0.8)).toBeGreaterThan(1);
});
it("Gate 9 stepped holds, invalid controls reject, engine stays independent of presets", () => {
  expect(evaluateCurve({ type: "stepped" }, 0.99)).toBe(0);
  for (const u of [-1, 2, NaN]) expect(() => evaluateCurve({ type: "linear" }, u)).toThrow();
  for (const curve of [
    { type: "unknown" },
    { type: "bezier", x1: 2, y1: 0, x2: 1, y2: 1 },
    { type: "overshoot", amount: -1 },
  ])
    expect(() => evaluateCurve(curve as Curve, 0.5)).toThrow();
  expect(readFileSync("packages/motion/src/curves.ts", "utf8")).not.toMatch(
    /from\s+["'][^"']*\/presets|from\s+["']@autospine\/spine/i,
  );
});
