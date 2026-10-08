import { Type, type Static } from "@sinclair/typebox";

import { IdSchema, NameSchema, SchemaVersionSchema } from "./common.js";

export const MotionParameterSchema = Type.Union([Type.Number(), Type.String(), Type.Boolean()]);

export const MotionSpecSchema = Type.Object(
  {
    targetId: IdSchema,
    type: Type.Union([
      Type.Literal("wave"),
      Type.Literal("sway"),
      Type.Literal("breathe"),
      Type.Literal("bounce"),
      Type.Literal("float"),
      Type.Literal("rotate-loop"),
      Type.Literal("blink"),
      Type.Literal("follow-through"),
      Type.Literal("overshoot"),
      Type.Literal("squash-stretch"),
    ]),
    parameters: Type.Record(Type.String({ minLength: 1 }), MotionParameterSchema),
  },
  { additionalProperties: false },
);

/**
 * Interpolation from this key to the next one; omitted means linear.
 * Engine-neutral and normalized per segment (like CSS cubic-bezier): x is the fraction of the
 * segment's time span, y the fraction of its value change. y may leave [0, 1] for overshoot.
 * A curve on a timeline's final key has no segment and is rejected by domain validation.
 */
export const KeyCurveSchema = Type.Union([
  Type.Object({ type: Type.Literal("linear") }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("stepped") }, { additionalProperties: false }),
  Type.Object(
    {
      type: Type.Literal("bezier"),
      x1: Type.Number({ minimum: 0, maximum: 1 }),
      y1: Type.Number({ minimum: -10, maximum: 10 }),
      x2: Type.Number({ minimum: 0, maximum: 1 }),
      y2: Type.Number({ minimum: -10, maximum: 10 }),
    },
    { additionalProperties: false },
  ),
]);

export const RotationTimelineSchema = Type.Object(
  {
    boneId: IdSchema,
    keys: Type.Array(
      Type.Object(
        {
          time: Type.Number({ minimum: 0 }),
          degrees: Type.Number(),
          curve: Type.Optional(KeyCurveSchema),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
  },
  { additionalProperties: false },
);

export const AnimationSpecSchema = Type.Object(
  {
    schemaVersion: SchemaVersionSchema,
    kind: Type.Literal("animation"),
    id: IdSchema,
    name: NameSchema,
    rigId: IdSchema,
    duration: Type.Number({ exclusiveMinimum: 0 }),
    loop: Type.Boolean(),
    seed: Type.Optional(Type.Integer()),
    motions: Type.Array(MotionSpecSchema),
    rotationTimelines: Type.Optional(Type.Array(RotationTimelineSchema)),
    translationTimelines: Type.Optional(
      Type.Array(
        Type.Object(
          {
            boneId: IdSchema,
            keys: Type.Array(
              Type.Object(
                {
                  time: Type.Number({ minimum: 0 }),
                  x: Type.Number(),
                  y: Type.Number(),
                  curve: Type.Optional(KeyCurveSchema),
                },
                { additionalProperties: false },
              ),
              { minItems: 1 },
            ),
          },
          { additionalProperties: false },
        ),
      ),
    ),
    scaleTimelines: Type.Optional(
      Type.Array(
        Type.Object(
          {
            boneId: IdSchema,
            keys: Type.Array(
              Type.Object(
                {
                  time: Type.Number({ minimum: 0 }),
                  x: Type.Number({ exclusiveMinimum: 0 }),
                  y: Type.Number({ exclusiveMinimum: 0 }),
                  curve: Type.Optional(KeyCurveSchema),
                },
                { additionalProperties: false },
              ),
              { minItems: 1 },
            ),
          },
          { additionalProperties: false },
        ),
      ),
    ),
    deformTimelines: Type.Optional(
      Type.Array(
        Type.Object(
          {
            meshId: IdSchema,
            keys: Type.Array(
              Type.Object(
                {
                  time: Type.Number({ minimum: 0 }),
                  offsets: Type.Array(Type.Tuple([Type.Number(), Type.Number()]), { minItems: 1 }),
                  curve: Type.Optional(KeyCurveSchema),
                },
                { additionalProperties: false },
              ),
              { minItems: 1 },
            ),
          },
          { additionalProperties: false },
        ),
      ),
    ),
  },
  { $id: "AnimationSpec-0.1", additionalProperties: false },
);

export type MotionParameter = Static<typeof MotionParameterSchema>;
export type MotionSpec = Static<typeof MotionSpecSchema>;
export type KeyCurve = Static<typeof KeyCurveSchema>;
export type RotationTimeline = Static<typeof RotationTimelineSchema>;
export type AnimationSpec = Static<typeof AnimationSpecSchema>;
