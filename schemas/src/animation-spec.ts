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

export const RotationTimelineSchema = Type.Object(
  {
    boneId: IdSchema,
    keys: Type.Array(
      Type.Object(
        { time: Type.Number({ minimum: 0 }), degrees: Type.Number() },
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
                { time: Type.Number({ minimum: 0 }), x: Type.Number(), y: Type.Number() },
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
export type RotationTimeline = Static<typeof RotationTimelineSchema>;
export type AnimationSpec = Static<typeof AnimationSpecSchema>;
