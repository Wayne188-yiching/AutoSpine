import type { JointRef, JointRule, PlanNumber, PlanValue } from "@autospine/schemas";
import { failStage } from "@autospine/rig";
import {
  apply,
  endCentroid,
  lerp,
  narrowest,
  opaquePoints,
  overlapCentroid,
  principal,
  project,
  dist,
  type CharacterPart,
  type Vec,
} from "./geometry.js";

export type Params = Record<string, number>;
/** Resolve a plan number: a literal, "$name" / "-$name", or "=expression" over parameters. */
export function num(value: PlanNumber, params: Params, where: string): number {
  if (typeof value === "number") return value;
  const lookup = (name: string) => {
    const v = params[name];
    if (v === undefined || !Number.isFinite(v))
      failStage("animation", "PLAN_PARAMETER", `${where} references unknown parameter ${name}`);
    return v;
  };
  if (!value.startsWith("=")) {
    const negative = value.startsWith("-");
    return negative ? -lookup(value.slice(2)) : lookup(value.slice(1));
  }
  const result = evaluateExpression(value.slice(1), lookup, where);
  if (!Number.isFinite(result))
    failStage("animation", "PLAN_EXPRESSION", `${where}: ${value} is not a finite number`);
  return result;
}
/** Recursive-descent arithmetic: numbers, $names, unary minus, + - * /, parentheses. No eval. */
function evaluateExpression(
  source: string,
  lookup: (name: string) => number,
  where: string,
): number {
  const tokens = source.match(/\$[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|\.\d+|[-+*/()]|\S/g) ?? [];
  let i = 0;
  const fail = (): never =>
    failStage("animation", "PLAN_EXPRESSION", `${where}: cannot parse expression "${source}"`);
  const factor = (): number => {
    const t = tokens[i++];
    if (t === undefined) return fail();
    if (t === "-") return -factor();
    if (t === "+") return factor();
    if (t === "(") {
      const v = expr();
      if (tokens[i++] !== ")") fail();
      return v;
    }
    if (t.startsWith("$")) return lookup(t.slice(1));
    if (/^(\d+(\.\d+)?|\.\d+)$/.test(t)) return Number(t);
    return fail();
  };
  const term = (): number => {
    let v = factor();
    while (tokens[i] === "*" || tokens[i] === "/")
      v = tokens[i++] === "*" ? v * factor() : v / factor();
    return v;
  };
  const expr = (): number => {
    let v = term();
    while (tokens[i] === "+" || tokens[i] === "-")
      v = tokens[i++] === "+" ? v + term() : v - term();
    return v;
  };
  const v = expr();
  if (i !== tokens.length) fail();
  return v;
}
export function val(value: PlanValue, params: Params, where: string): number | [number, number] {
  return Array.isArray(value)
    ? [num(value[0], params, where), num(value[1], params, where)]
    : num(value as PlanNumber, params, where);
}

/** Parts of the layout with cached opaque world points. */
export class PartIndex {
  private readonly points = new Map<string, Vec[]>();
  constructor(readonly parts: ReadonlyMap<string, CharacterPart>) {}
  part(name: string): CharacterPart {
    const p = this.parts.get(name);
    if (!p)
      failStage(
        "asset",
        "PLAN_PART",
        `Plan references part ${name}, which the layout does not have`,
      );
    return p;
  }
  opaque(name: string): Vec[] {
    let pts = this.points.get(name);
    if (!pts) {
      pts = opaquePoints(this.part(name), 2);
      if (!pts.length) failStage("asset", "PLAN_PART_EMPTY", `Part ${name} has no opaque pixels`);
      this.points.set(name, pts);
    }
    return pts;
  }
  centroid(name: string): Vec {
    return principal(this.opaque(name)).centroid;
  }
}

/** Evaluates joint rules on demand with memoisation and cycle detection. */
export class JointSolver {
  readonly values = new Map<string, Vec>();
  readonly evidence: Record<string, unknown> = {};
  private readonly active = new Set<string>();
  constructor(
    private readonly index: PartIndex,
    private readonly rules: Record<string, JointRule>,
    private readonly dome: () => Vec,
  ) {}
  /** All named joints, in plan order. */
  solveAll(): Record<string, Vec> {
    for (const id of Object.keys(this.rules)) this.get(id);
    return Object.fromEntries([...this.values]);
  }
  get(ref: JointRef): Vec {
    if (typeof ref !== "string") return this.evaluate(ref, "(inline)");
    const known = this.values.get(ref);
    if (known) return known;
    const rule = this.rules[ref];
    if (!rule) failStage("rig", "PLAN_JOINT", `Unknown joint ${ref}`);
    if (this.active.has(ref))
      failStage("rig", "PLAN_JOINT_CYCLE", `Joint ${ref} depends on itself`);
    this.active.add(ref);
    const v = this.evaluate(rule, ref);
    this.active.delete(ref);
    if (!Number.isFinite(v[0]) || !Number.isFinite(v[1]))
      failStage("rig", "PLAN_JOINT_VALUE", `Joint ${ref} did not resolve to a finite point`);
    this.values.set(ref, v);
    return v;
  }
  private evaluate(rule: JointRule, id: string): Vec {
    const ix = this.index;
    switch (rule.rule) {
      case "centroid":
        return ix.centroid(rule.part);
      case "center": {
        const p = ix.part(rule.part);
        return apply(p.affine, [p.width / 2, p.height / 2]);
      }
      case "overlap": {
        const c = overlapCentroid(ix.part(rule.parts[0]), ix.part(rule.parts[1]));
        if (!c)
          failStage(
            "rig",
            "PLAN_JOINT_OVERLAP",
            `Joint ${id}: ${rule.parts[0]} and ${rule.parts[1]} do not overlap`,
          );
        return c;
      }
      case "end":
        return endCentroid(ix.opaque(rule.part), rule.dir, rule.band ?? 6);
      case "axisEnd": {
        const [e0, e1] = principal(ix.opaque(rule.part)).ends;
        switch (rule.pick) {
          case "top":
            return e0[1] < e1[1] ? e0 : e1;
          case "bottom":
            return e0[1] < e1[1] ? e1 : e0;
          case "left":
            return e0[0] < e1[0] ? e0 : e1;
          case "right":
            return e0[0] < e1[0] ? e1 : e0;
          default: {
            if (rule.ref === undefined)
              failStage("rig", "PLAN_JOINT_REF", `Joint ${id}: pick ${rule.pick} needs a ref`);
            const r = this.get(rule.ref),
              d0 = dist(e0, r),
              d1 = dist(e1, r);
            return rule.pick === "near" ? (d0 < d1 ? e0 : e1) : d0 > d1 ? e0 : e1;
          }
        }
      }
      case "lerp":
        return lerp(this.get(rule.a), this.get(rule.b), rule.t);
      case "project":
        return project(this.get(rule.point), this.get(rule.a), this.get(rule.b));
      case "narrowest": {
        const r = narrowest(
          ix.opaque(rule.part),
          this.get(rule.a),
          this.get(rule.b),
          rule.range[0],
          rule.range[1],
        );
        if (!r)
          failStage(
            "rig",
            "PLAN_JOINT_NARROWEST",
            `Joint ${id}: no cross-section of ${rule.part} in range`,
          );
        this.evidence[`${id}:narrowest`] = { width: r.width };
        return r.point;
      }
      case "domeCenter":
        return this.dome();
      case "point":
        return [rule.at[0], rule.at[1]];
    }
  }
}
