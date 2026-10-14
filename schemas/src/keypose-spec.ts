import { Type, type Static } from "@sinclair/typebox";
import { KeyCurveSchema } from "./animation-spec.js";
import { IdSchema, NameSchema, SchemaVersionSchema, Vector2Schema } from "./common.js";

/**
 * Outer motion-authoring contract, compiled to AnimationSpec by `@autospine/motion`.
 * A pose table (beats) sets primary poses; rules derive the secondary timing.
 * Times are integer frames on the spec's frame grid. Authored values are offsets from rest
 * (rotate/translate) or scale factors, in units of the control's `unit`.
 */
export const KeyposeEaseSchema = Type.Union([
  Type.Literal("linear"),
  Type.Literal("hold"),
  Type.Literal("ease"),
  Type.Literal("sine"),
  Type.Literal("out"),
  Type.Literal("in"),
  Type.Literal("drift"),
  KeyCurveSchema,
]);
const strict = { additionalProperties: false };
const frame = Type.Integer({ minimum: 0, maximum: 3600 });
const lag = Type.Integer({ minimum: -3600, maximum: 3600 });
const KeyposeValueSchema = Type.Union([Type.Number(), Vector2Schema]);
const GainSchema = Type.Union([Type.Number(), Vector2Schema]);

export const KeyposeControlSchema = Type.Object(
  {
    id: IdSchema,
    boneId: IdSchema,
    channel: Type.Union([Type.Literal("rotate"), Type.Literal("translate"), Type.Literal("scale")]),
    /** Translate only: authored axes. "world" is IR image space (+x right, +y down) at setup. */
    space: Type.Optional(Type.Union([Type.Literal("world"), Type.Literal("parent")])),
    /** Rotate/translate only: degrees or pixels per authored unit (e.g. a measured head width). */
    unit: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 100000 })),
  },
  strict,
);

export const KeyposeBeatSchema = Type.Object(
  {
    frame,
    /** How every control posed in this beat arrives here; default "ease". */
    ease: Type.Optional(KeyposeEaseSchema),
    poses: Type.Record(
      IdSchema,
      Type.Union([
        KeyposeValueSchema,
        Type.Object({ value: KeyposeValueSchema, ease: KeyposeEaseSchema }, strict),
      ]),
    ),
  },
  strict,
);

export const KeyposeRuleSchema = Type.Union([
  /** Overlap / delay chain / mirrored side: source offset delayed by `lag` frames and scaled. */
  Type.Object(
    {
      rule: Type.Literal("follow"),
      control: IdSchema,
      source: IdSchema,
      lag,
      gain: GainSchema,
      /** Scalar follower of a vector source reads this component. */
      component: Type.Optional(Type.Union([Type.Literal("x"), Type.Literal("y")])),
    },
    strict,
  ),
  /** Eyes: jump to the source's next pose within `move` frames, then hold; optionally lead. */
  Type.Object(
    {
      rule: Type.Literal("saccade"),
      control: IdSchema,
      source: IdSchema,
      gain: GainSchema,
      move: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })),
      lead: Type.Optional(Type.Integer({ minimum: 0, maximum: 120 })),
      moveEase: Type.Optional(KeyposeEaseSchema),
    },
    strict,
  ),
  /** One-shot drag release: hold `from` until `start`, overshoot past `to`, decay to rest. */
  Type.Object(
    {
      rule: Type.Literal("settle"),
      control: IdSchema,
      from: KeyposeValueSchema,
      to: Type.Optional(KeyposeValueSchema),
      start: frame,
      travel: Type.Integer({ minimum: 1, maximum: 3600 }),
      overshoot: Type.Number({ minimum: 0, maximum: 2 }),
      damping: Type.Number({ minimum: 0, maximum: 0.95 }),
      period: Type.Integer({ minimum: 1, maximum: 3600 }),
      /** Extremes after the travel; default: until they decay below 10% of the first overshoot. */
      bounces: Type.Optional(Type.Integer({ minimum: 0, maximum: 12 })),
      travelEase: Type.Optional(KeyposeEaseSchema),
    },
    strict,
  ),
  /** Sparse oscillation keyed only at its extremes (sine-like ease between them). */
  Type.Object(
    {
      rule: Type.Literal("cycle"),
      control: IdSchema,
      center: Type.Optional(KeyposeValueSchema),
      amplitude: KeyposeValueSchema,
      period: Type.Integer({ minimum: 4, maximum: 3600 }),
      phase: Type.Optional(lag),
    },
    strict,
  ),
]);

export const KeyposeSpecSchema = Type.Object(
  {
    schemaVersion: SchemaVersionSchema,
    kind: Type.Literal("keypose-spec"),
    id: IdSchema,
    name: NameSchema,
    rigId: IdSchema,
    fps: Type.Integer({ minimum: 1, maximum: 60 }),
    frames: Type.Integer({ minimum: 1, maximum: 3600 }),
    loop: Type.Boolean(),
    controls: Type.Array(KeyposeControlSchema, { minItems: 1, maxItems: 256 }),
    beats: Type.Array(KeyposeBeatSchema, { maxItems: 1024 }),
    rules: Type.Array(KeyposeRuleSchema, { maxItems: 256 }),
  },
  { $id: "KeyposeSpec-0.1", ...strict },
);

export type KeyposeEase = Static<typeof KeyposeEaseSchema>;
export type KeyposeControl = Static<typeof KeyposeControlSchema>;
export type KeyposeBeat = Static<typeof KeyposeBeatSchema>;
export type KeyposeRule = Static<typeof KeyposeRuleSchema>;
export type KeyposeSpec = Static<typeof KeyposeSpecSchema>;
