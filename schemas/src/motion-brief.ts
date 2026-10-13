import { Type, type Static } from "@sinclair/typebox";
import { KeyposeEaseSchema } from "./keypose-spec.js";
import { IdSchema, NameSchema, SchemaVersionSchema } from "./common.js";

/**
 * Declarative statement of *what the motion does*, from which `@autospine/motion` derives *when*
 * it happens. A brief carries structure (ordered phases and their jobs), never timecodes: the
 * planner owns every frame number. Pose values stay with the caller; a brief says nothing about
 * how far anything moves.
 */
const strict = { additionalProperties: false };

/** What a phase is *for*; the planner reads the job, not the name. */
export const MotionPhaseKindSchema = Type.Union([
  /** Small counter-move that announces the main action. */
  Type.Literal("anticipation"),
  /** The displacement the action is about. */
  Type.Literal("travel"),
  /** Absorption of the travel: overshoot decaying into the arrival pose. */
  Type.Literal("settle"),
  /** Deliberate pause so the arrival pose can be read. */
  Type.Literal("hold"),
  /** Attention shift: a hold with a target, usually driven onward by a `saccade` rule. */
  Type.Literal("look"),
  /** Travel back along a path the viewer has already read. */
  Type.Literal("return"),
]);

export const MotionPhaseSchema = Type.Object(
  {
    /** Stable handle for poses and reports; defaults to `kind-index`. */
    id: Type.Optional(IdSchema),
    kind: MotionPhaseKindSchema,
    /** Overrides the kind's structural share. Relative, unitless; only ratios matter. */
    weight: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 1000 })),
    /** Overrides the planner's readability floor, downwards as well as upwards. */
    minFrames: Type.Optional(Type.Integer({ minimum: 1, maximum: 3600 })),
    maxFrames: Type.Optional(Type.Integer({ minimum: 1, maximum: 3600 })),
    /** Overrides the arrival ease the planner derives from the kind. */
    ease: Type.Optional(KeyposeEaseSchema),
  },
  strict,
);

/**
 * Whole-motion rhythm personality. Both knobs are unitless in [0, 1] with a neutral 0.5 default,
 * so a brief never has to name a frame count to get a usable timing.
 */
export const MotionRhythmSchema = Type.Object(
  {
    /** Concentration of the moving phases; higher trades travel time for held time. */
    snappiness: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    /** Share of the budget that goes to read-the-pose phases rather than to absorption. */
    holdBias: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  },
  strict,
);

export const MotionBriefSchema = Type.Object(
  {
    schemaVersion: SchemaVersionSchema,
    kind: Type.Literal("motion-brief"),
    id: IdSchema,
    name: NameSchema,
    fps: Type.Integer({ minimum: 1, maximum: 60 }),
    /** Exactly one of `seconds` or `frames` states the budget; `seconds` is rounded on the grid. */
    seconds: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 60 })),
    frames: Type.Optional(Type.Integer({ minimum: 1, maximum: 3600 })),
    loop: Type.Boolean(),
    phases: Type.Array(MotionPhaseSchema, { minItems: 1, maxItems: 64 }),
    /**
     * Repeats the phase list this many times inside the budget, e.g. two breaths in a 4 s idle
     * loop or three jolts in a shake. Defaults to 1. `suggestLoopCycles` gives a measured default.
     */
    cycles: Type.Optional(Type.Integer({ minimum: 1, maximum: 32 })),
    rhythm: Type.Optional(MotionRhythmSchema),
  },
  { $id: "MotionBrief-0.1", ...strict },
);

export type MotionPhaseKind = Static<typeof MotionPhaseKindSchema>;
export type MotionPhase = Static<typeof MotionPhaseSchema>;
export type MotionRhythm = Static<typeof MotionRhythmSchema>;
export type MotionBrief = Static<typeof MotionBriefSchema>;
