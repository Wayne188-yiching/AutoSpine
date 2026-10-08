import { Value } from "@sinclair/typebox/value";
import { PartRoleSchema, type PartRole } from "@autospine/schemas";
import { failStage } from "@autospine/rig";

/** How a part's geometry is built. Mirrors the mesh strategies `@autospine/mesh` exposes. */
export type MeshStrategy =
  /** Feature-ring mesh for plates with holes (face, bandage); rings become dome pins. */
  | "feature"
  /** Regular grid over the image, for layers that must follow a surface smoothly. */
  | "surface"
  /** Outline-only mesh, no interior grid points. */
  | "contour"
  /** Contour mesh authored to be driven by a bone chain. */
  | "chain";

/** Which weight solver in this package owns the part. */
export type WeightSolver =
  | "dome"
  | "gradient"
  | "chain"
  | "transfer"
  /** One bone, no deformation: the part moves as a unit. */
  | "rigid";

/**
 * Starting parameters, **not** quality gates. Every value below is a measured starting point from
 * the engine pipeline reference (`skills/autospine/references/engine-pipeline.md`), taken from one
 * private character trial plus the synthetic cases in `tests/`. Each character must re-measure in
 * its own motion; passing these numbers through unchanged is not evidence of anything.
 *
 * Ratios are dimensionless on purpose so they transfer across canvas sizes. No character-specific
 * pixel number belongs here.
 */
export interface RolePlanParams {
  /** Dome control weight at the field centre. Reference starting value: 0.7. */
  domePeak?: number;
  /** Dome counter-bone weight past the rim. Reference starting value: 0.1. */
  domeCounter?: number;
  /**
   * Socket-pin blend margin as a fraction of measured head width. Reference starting value: 0.12;
   * the reference records 0.06 folding on large head turns, so this is a floor to measure from,
   * not a safe minimum.
   */
  pinMarginHeadWidthRatio?: number;
  /**
   * Chain blend width at a joint as a fraction of the *shorter* adjacent bone length. Reference
   * starting value: 0.4; the reference records folding at and below 0.15.
   */
  chainWidthShorterBoneRatio?: number;
  /**
   * Surface-grid cell size in image pixels for glow layers. Reference starting value: ~40 px. The
   * one pixel-valued default here: it is a sampling resolution on the source image, not an
   * anatomical measurement, and has no dimensionless form without a canvas reference.
   */
  surfaceCellPx?: number;
}

export interface RolePlan {
  mesh: MeshStrategy;
  solver: WeightSolver;
  params: RolePlanParams;
  /**
   * True when the plan is a safe placeholder rather than a decision: `unknown` parts get a rigid,
   * non-deforming plan so nothing silently deforms, and the caller must label the part first.
   */
  deferred: boolean;
}

const DOME_PARAMS: RolePlanParams = {
  domePeak: 0.7,
  domeCounter: 0.1,
  pinMarginHeadWidthRatio: 0.12,
};
const CHAIN_PARAMS: RolePlanParams = { chainWidthShorterBoneRatio: 0.4 };

/**
 * Default mesh/solver per role, from the pipeline reference's step order:
 *  - face plate and bandages share one dome field and a feature mesh with hole rings (steps 1, 2);
 *  - the eye assembly (sclera, pupil, lids) moves rigidly on the dome's follow mix, except the
 *    lids, which are a two-bone gradient (step 3);
 *  - limbs share a bone chain across jointed images, while parts that merely cover a joint (palm,
 *    foot) keep their own bone and stay rigid (step 4);
 *  - glow/outline takes a ~40 px surface grid and transfers weights from the base mesh (step 5).
 *
 * `ear` is not covered by the reference; it defaults to rigid-on-its-own-bone, the choice that
 * deforms nothing, and is flagged for the caller rather than guessed into the dome.
 */
export const roleDefaults: Readonly<Record<PartRole, RolePlan>> = Object.freeze({
  face: { mesh: "feature", solver: "dome", params: { ...DOME_PARAMS }, deferred: false },
  "eye-white": { mesh: "contour", solver: "rigid", params: {}, deferred: false },
  pupil: { mesh: "contour", solver: "rigid", params: {}, deferred: false },
  eyelid: { mesh: "contour", solver: "gradient", params: {}, deferred: false },
  ear: { mesh: "contour", solver: "rigid", params: {}, deferred: true },
  torso: { mesh: "chain", solver: "chain", params: { ...CHAIN_PARAMS }, deferred: false },
  "upper-arm": { mesh: "chain", solver: "chain", params: { ...CHAIN_PARAMS }, deferred: false },
  forearm: { mesh: "chain", solver: "chain", params: { ...CHAIN_PARAMS }, deferred: false },
  palm: { mesh: "contour", solver: "rigid", params: {}, deferred: false },
  finger: { mesh: "chain", solver: "chain", params: { ...CHAIN_PARAMS }, deferred: false },
  "upper-leg": { mesh: "chain", solver: "chain", params: { ...CHAIN_PARAMS }, deferred: false },
  "lower-leg": { mesh: "chain", solver: "chain", params: { ...CHAIN_PARAMS }, deferred: false },
  foot: { mesh: "contour", solver: "rigid", params: {}, deferred: false },
  tail: { mesh: "chain", solver: "chain", params: { ...CHAIN_PARAMS }, deferred: false },
  "loose-wrap": { mesh: "feature", solver: "dome", params: { ...DOME_PARAMS }, deferred: false },
  glow: { mesh: "surface", solver: "transfer", params: { surfaceCellPx: 40 }, deferred: false },
  unknown: { mesh: "contour", solver: "rigid", params: {}, deferred: true },
});

/** Per-role, partial replacement of the defaults. Params merge key by key; mesh/solver replace. */
export type RolePlanOverrides = Partial<
  Record<PartRole, Partial<Omit<RolePlan, "params">> & { params?: RolePlanParams }>
>;

const MESH_STRATEGIES = new Set<string>(["feature", "surface", "contour", "chain"]);
const WEIGHT_SOLVERS = new Set<string>(["dome", "gradient", "chain", "transfer", "rigid"]);

function checkParams(params: RolePlanParams): void {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value < 0)
      failStage("weights", "ROLE_PLAN_PARAM", `Role plan parameter ${key} must be finite and >= 0`);
  }
}

/**
 * Returns the mesh strategy, weight solver and starting parameters for a role. Pure and
 * deterministic; the returned plan is a frozen copy, so callers cannot mutate the defaults.
 */
export function resolveRolePlan(role: PartRole, overrides: RolePlanOverrides = {}): RolePlan {
  if (!Value.Check(PartRoleSchema, role))
    failStage("weights", "ROLE_PLAN_ROLE", "A declared PartRole is required");
  const base = roleDefaults[role];
  const override = Object.hasOwn(overrides, role) ? overrides[role] : undefined;
  if (!override) return Object.freeze({ ...base, params: Object.freeze({ ...base.params }) });
  if (override.mesh !== undefined && !MESH_STRATEGIES.has(override.mesh))
    failStage("weights", "ROLE_PLAN_MESH", "Unknown mesh strategy override");
  if (override.solver !== undefined && !WEIGHT_SOLVERS.has(override.solver))
    failStage("weights", "ROLE_PLAN_SOLVER", "Unknown weight solver override");
  const params = { ...base.params, ...(override.params ?? {}) };
  checkParams(params);
  return Object.freeze({
    mesh: override.mesh ?? base.mesh,
    solver: override.solver ?? base.solver,
    params: Object.freeze(params),
    deferred: override.deferred ?? base.deferred,
  });
}
