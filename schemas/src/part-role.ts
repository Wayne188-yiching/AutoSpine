import { Type, type Static } from "@sinclair/typebox";

import { IdSchema, SchemaVersionSchema } from "./common.js";

/**
 * Semantic labels for asset parts. The engine owns the algorithms; a character only states
 * *what each slot is*, and the engine derives mesh strategy, weight solver and parameters.
 * Roles are declared by the caller, never inferred from pixels: region analysis in
 * `@autospine/rig` is explicit that pixel evidence does not determine anatomical roles.
 */
export const PartRoleSchema = Type.Union([
  /** Face plate the parallax dome field is measured on. */
  Type.Literal("face"),
  /** Eye sclera; the rigid feature a socket rim is pinned to. */
  Type.Literal("eye-white"),
  Type.Literal("pupil"),
  Type.Literal("eyelid"),
  Type.Literal("ear"),
  Type.Literal("torso"),
  Type.Literal("upper-arm"),
  Type.Literal("forearm"),
  /** Covers a joint but keeps its own bone; never merged into a limb chain. */
  Type.Literal("palm"),
  Type.Literal("finger"),
  Type.Literal("upper-leg"),
  Type.Literal("lower-leg"),
  Type.Literal("foot"),
  Type.Literal("tail"),
  /** Bandage, scarf or cloth wrap: a layer that shares the surface it covers. */
  Type.Literal("loose-wrap"),
  /** Glow, rim light or outline that rides another part rather than owning a rig. */
  Type.Literal("glow"),
  /** Declared-unlabelled. Never a guess: the caller must decide before rigging. */
  Type.Literal("unknown"),
]);

/** Anatomical side: left, right, or centre/unsided. */
export const PartSideSchema = Type.Union([Type.Literal("l"), Type.Literal("r"), Type.Literal("c")]);

export type PartRole = Static<typeof PartRoleSchema>;
export type PartSide = Static<typeof PartSideSchema>;

/** Schema order, kept as data so callers can iterate the vocabulary exhaustively. */
export const PART_ROLES = Object.freeze(
  PartRoleSchema.anyOf.map((member) => (member as { const: PartRole }).const),
) as readonly PartRole[];

/**
 * Upper bounds on an authored `match` source. A label map is caller-supplied data compiled into
 * a live `RegExp`, so the input is bounded before compilation: long, quantifier-dense sources are
 * the shape that backtracks catastrophically. The limits sit far above any real slot-naming rule;
 * the applier enforces structural limits again at compile time.
 */
export const PART_LABEL_PATTERN_MAX_LENGTH = 200;
export const PART_LABEL_MAX_PATTERNS = 64;

export const PartLabelPatternSchema = Type.Object(
  {
    /** JavaScript regular-expression *source*: no delimiters, no inline flags. */
    match: Type.String({ minLength: 1, maxLength: PART_LABEL_PATTERN_MAX_LENGTH }),
    /** Opt-in case folding; flags are never parsed out of `match`, so the source stays literal. */
    ignoreCase: Type.Optional(Type.Boolean()),
    role: PartRoleSchema,
    side: Type.Optional(PartSideSchema),
  },
  { additionalProperties: false },
);

/** Per-part escape hatch for slots a naming rule cannot express. */
export const PartLabelOverrideSchema = Type.Object(
  {
    role: PartRoleSchema,
    side: Type.Optional(PartSideSchema),
    rides: Type.Optional(IdSchema),
  },
  { additionalProperties: false },
);

/**
 * The character-side half of "parts carry meaning": naming rules plus per-part overrides.
 * Authoring-side input like KeyposeSpec and MotionBrief, so it is intentionally absent from
 * `SPEC_SCHEMAS` (the eight pipeline IR documents a BuildManifest references).
 */
export const PartLabelMapSchema = Type.Object(
  {
    schemaVersion: SchemaVersionSchema,
    kind: Type.Literal("part-labels"),
    id: IdSchema,
    /** Evaluated in order against a part's `name`; first hit wins. */
    patterns: Type.Array(PartLabelPatternSchema, { maxItems: PART_LABEL_MAX_PATTERNS }),
    /** Keyed by part id; beats every pattern. */
    overrides: Type.Optional(Type.Record(Type.String({ minLength: 1 }), PartLabelOverrideSchema)),
  },
  { $id: "PartLabelMap-0.1", additionalProperties: false },
);

export type PartLabelPattern = Static<typeof PartLabelPatternSchema>;
export type PartLabelOverride = Static<typeof PartLabelOverrideSchema>;
export type PartLabelMap = Static<typeof PartLabelMapSchema>;
