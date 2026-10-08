import type { MeshSpec, RigSpec, WeightSpec } from "@autospine/schemas";
import { failStage, transformPoint, type Affine } from "@autospine/rig";
import { validateWeights } from "./index.js";

/**
 * Parallax ("dome") field for a layered face or body front, in the rig's world space
 * (IR image axes, +x right, +y down). Moving the control bone slides the middle of the surface
 * while the rim stays on the base bone, which reads as a turn. Every mesh of one head shares the
 * field, so stacked layers and cut-outs move identically wherever they overlap.
 */
export interface DomeField {
  center: [number, number];
  /** Semi-axes along world x and y; vertices beyond them get no control weight. */
  radii: [number, number];
  /** Control-bone weight at the centre, (0, 1]. */
  peak: number;
  /** Counter-bone weight past the rim, [0, 1 - peak]; drive the counter bone against the turn. */
  counter: number;
}
export interface DomeBones {
  base: string;
  control: string;
  counter?: string;
}
/**
 * A region of the surface that must move with a rigid feature showing through it (an eye socket
 * rim over the eye assembly): inside the polygon the control weight equals `value` (that feature's
 * follow mix), then it blends back into the dome over `margin` world units.
 */
export interface DomePin {
  polygon: [number, number][];
  value: number;
  margin: number;
}
/** Normalized radius band over which the counter weight ramps in. */
const COUNTER_BAND: [number, number] = [0.55, 1.1];

function checkPins(pins: DomePin[]) {
  if (
    !Array.isArray(pins) ||
    pins.some(
      (pin) =>
        !Array.isArray(pin.polygon) ||
        pin.polygon.length < 3 ||
        !pin.polygon.flat().every(Number.isFinite) ||
        !(pin.value >= 0 && pin.value <= 1) ||
        !(pin.margin > 0 && Number.isFinite(pin.margin)),
    )
  )
    failStage("weights", "DOME_PIN", "Pins need a finite polygon, value in [0, 1] and margin > 0");
}
/** Strongest pin influence at p: 1 inside its polygon, smoothstep down to 0 at `margin` outside. */
function pinAt(pins: DomePin[], p: [number, number]): { blend: number; value: number } {
  let best = { blend: 0, value: 0 };
  for (const pin of pins) {
    const poly = pin.polygon;
    let inside = false,
      distance = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!,
        b = poly[j]!;
      if (
        a[1] > p[1] !== b[1] > p[1] &&
        p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
      )
        inside = !inside;
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        t = Math.max(
          0,
          Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
        );
      distance = Math.min(distance, Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t));
    }
    const u = inside ? 0 : Math.min(1, distance / pin.margin),
      blend = 1 - u * u * (3 - 2 * u);
    if (blend > best.blend) best = { blend, value: pin.value };
  }
  return best;
}

function checkField(field: DomeField) {
  const { center, radii, peak, counter } = field;
  if (
    ![...center, ...radii, peak, counter].every(Number.isFinite) ||
    radii[0] <= 0 ||
    radii[1] <= 0 ||
    peak <= 0 ||
    peak > 1 ||
    counter < 0 ||
    peak + counter > 1
  )
    failStage(
      "weights",
      "DOME_FIELD",
      "Finite centre, positive radii, peak in (0, 1] and counter keeping peak + counter <= 1",
    );
}
const normalizedRadius = (field: DomeField, p: [number, number]) =>
  Math.hypot((p[0] - field.center[0]) / field.radii[0], (p[1] - field.center[1]) / field.radii[1]);

/** Control weight at a point; use it as the follow mix of a rigid feature riding the surface. */
export function domeValue(field: DomeField, point: [number, number], pins: DomePin[] = []): number {
  checkField(field);
  checkPins(pins);
  const r = normalizedRadius(field, point),
    dome = field.peak * Math.max(0, 1 - r * r),
    { blend, value } = pinAt(pins, point);
  return dome + (value - dome) * blend;
}
/**
 * Control displacement along world x and y at which the surface folds at the rim
 * (2 * peak * d / radius = 1). Keep the control's travel well inside it; a moving counter bone
 * tightens it slightly.
 */
export function domeFoldLimit(field: DomeField): [number, number] {
  checkField(field);
  return [field.radii[0] / (2 * field.peak), field.radii[1] / (2 * field.peak)];
}

/**
 * Measures a field from an image: radii are twice the alpha standard deviation (exact for a filled
 * ellipse), the centre is the alpha centroid unless a feature `anchor` (e.g. the eyes) is given.
 * `toWorld` maps pixel coordinates (top-left origin, +y down) to world space.
 */
export function measureDomeField(
  alpha: ArrayLike<number>,
  width: number,
  height: number,
  toWorld: Affine,
  options: { anchor?: [number, number]; peak?: number; counter?: number; threshold?: number } = {},
): DomeField {
  const { anchor, peak = 0.7, counter = 0.1, threshold = 128 } = options;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    alpha.length !== width * height ||
    toWorld.length !== 6 ||
    !toWorld.every(Number.isFinite)
  )
    failStage(
      "weights",
      "DOME_INPUT",
      "Alpha must match a positive integer size and finite placement",
    );
  let n = 0,
    sx = 0,
    sy = 0,
    sxx = 0,
    syy = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x]! < threshold) continue;
      const [wx, wy] = transformPoint(toWorld, [x + 0.5, y + 0.5]);
      n++;
      sx += wx;
      sy += wy;
      sxx += wx * wx;
      syy += wy * wy;
    }
  if (n < 3) failStage("weights", "DOME_INPUT", "At least three opaque pixels are required");
  const mx = sx / n,
    my = sy / n;
  const field: DomeField = {
    center: anchor ?? [mx, my],
    radii: [
      2 * Math.sqrt(Math.max(0, sxx / n - mx * mx)),
      2 * Math.sqrt(Math.max(0, syy / n - my * my)),
    ],
    peak,
    counter,
  };
  checkField(field);
  return field;
}

/** Dome weights for one mesh whose vertices are already in the field's world space. */
export function solveDomeWeights(
  mesh: MeshSpec,
  rig: RigSpec,
  field: DomeField,
  bones: DomeBones,
  pins: DomePin[] = [],
): WeightSpec {
  checkField(field);
  checkPins(pins);
  const ids = [bones.base, bones.control, ...(bones.counter ? [bones.counter] : [])];
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => !rig.bones.some((b) => b.id === id)) ||
    (field.counter > 0 && !bones.counter)
  )
    failStage(
      "weights",
      "DOME_BONES",
      "Distinct existing base and control bones, plus a counter bone when counter > 0",
    );
  const [e0, e1] = COUNTER_BAND;
  const result: WeightSpec = {
    schemaVersion: "0.1",
    kind: "weights",
    id: mesh.id + "-dome-weights",
    meshId: mesh.id,
    rigId: rig.id,
    vertices: mesh.vertices.map((p, vertexIndex) => {
      const r = normalizedRadius(field, p),
        dome = field.peak * Math.max(0, 1 - r * r),
        t = Math.min(1, Math.max(0, (r - e0) / (e1 - e0))),
        { blend, value } = pinAt(pins, p),
        control = dome + (value - dome) * blend,
        counter = field.counter * t * t * (3 - 2 * t) * (1 - blend);
      const influences = [
        { boneId: bones.control, weight: control },
        ...(bones.counter ? [{ boneId: bones.counter, weight: counter }] : []),
        { boneId: bones.base, weight: 1 - control - counter },
      ].filter((i) => i.weight > 1e-9);
      const sum = influences.reduce((s, i) => s + i.weight, 0);
      return { vertexIndex, influences: influences.map((i) => ({ ...i, weight: i.weight / sum })) };
    }),
  };
  validateWeights(mesh, rig, result);
  return result;
}
