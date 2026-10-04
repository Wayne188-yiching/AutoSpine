import { failStage } from "@autospine/rig";

export type Curve =
  | { type: "linear" | "stepped" | "ease" }
  | { type: "bezier"; x1: number; y1: number; x2: number; y2: number }
  | { type: "overshoot"; amount: number };
/** Standalone normalized scalar curve; no preset or Spine dependency. */
export function evaluateCurve(curve: Curve, u: number): number {
  if (!Number.isFinite(u) || u < 0 || u > 1 || !curve || typeof curve !== "object")
    failStage("animation", "CURVE_INPUT", "Normalized finite time and curve required");
  const keys = Object.keys(curve);
  const expected =
    curve.type === "bezier"
      ? ["type", "x1", "y1", "x2", "y2"]
      : curve.type === "overshoot"
        ? ["type", "amount"]
        : ["type"];
  if (keys.length !== expected.length || keys.some((k) => !expected.includes(k)))
    failStage("animation", "CURVE_INPUT", "Invalid curve fields");
  if (
    curve.type === "bezier" &&
    (![curve.x1, curve.y1, curve.x2, curve.y2].every(Number.isFinite) ||
      curve.x1 < 0 ||
      curve.x1 > 1 ||
      curve.x2 < 0 ||
      curve.x2 > 1 ||
      Math.abs(curve.y1) > 10 ||
      Math.abs(curve.y2) > 10)
  )
    failStage("animation", "CURVE_BEZIER", "Bounded finite Bezier controls required");
  if (
    curve.type === "overshoot" &&
    (!Number.isFinite(curve.amount) || curve.amount < 0 || curve.amount > 3)
  )
    failStage("animation", "CURVE_OVERSHOOT", "Overshoot amount must be in [0,3]");
  if (!["linear", "stepped", "ease", "bezier", "overshoot"].includes(curve.type))
    failStage("animation", "CURVE_TYPE", "Unknown curve type");
  if (u === 0 || u === 1) return u;
  switch (curve.type) {
    case "linear":
      return u;
    case "stepped":
      return 0;
    case "ease":
      return u * u * (3 - 2 * u);
    case "overshoot": {
      const t = u - 1;
      return 1 + (curve.amount + 1) * t * t * t + curve.amount * t * t;
    }
    case "bezier": {
      const cubic = (t: number, a: number, b: number) =>
        3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
      let lo = 0,
        hi = 1;
      for (let i = 0; i < 60; i++) {
        const t = (lo + hi) / 2;
        if (cubic(t, curve.x1, curve.x2) < u) lo = t;
        else hi = t;
      }
      return cubic((lo + hi) / 2, curve.y1, curve.y2);
    }
  }
}
