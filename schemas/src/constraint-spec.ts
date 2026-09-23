import { Type, type Static } from "@sinclair/typebox";

import { IdSchema, NameSchema, SchemaVersionSchema } from "./common.js";

const ConstraintBase = {
  id: IdSchema,
  name: NameSchema,
  boneIds: Type.Array(IdSchema, { minItems: 1 }),
};

export const IkConstraintSchema = Type.Object(
  {
    ...ConstraintBase,
    type: Type.Literal("ik"),
    targetBoneId: IdSchema,
    mix: Type.Number({ minimum: 0, maximum: 1 }),
    bendDirection: Type.Union([Type.Literal("positive"), Type.Literal("negative")]),
  },
  { additionalProperties: false },
);

export const TransformConstraintSchema = Type.Object(
  {
    ...ConstraintBase,
    type: Type.Literal("transform"),
    targetBoneId: IdSchema,
    local: Type.Boolean(),
    relative: Type.Boolean(),
    rotateMix: Type.Number({ minimum: 0, maximum: 1 }),
    translateMix: Type.Number({ minimum: 0, maximum: 1 }),
    scaleMix: Type.Number({ minimum: 0, maximum: 1 }),
    shearMix: Type.Number({ minimum: 0, maximum: 1 }),
  },
  { additionalProperties: false },
);

export const PathConstraintSchema = Type.Object(
  {
    ...ConstraintBase,
    type: Type.Literal("path"),
    targetPathId: IdSchema,
    position: Type.Number(),
    spacing: Type.Number(),
    rotateMix: Type.Number({ minimum: 0, maximum: 1 }),
    translateMix: Type.Number({ minimum: 0, maximum: 1 }),
  },
  { additionalProperties: false },
);

export const ConstraintSchema = Type.Union([
  IkConstraintSchema,
  TransformConstraintSchema,
  PathConstraintSchema,
]);

export const ConstraintSpecSchema = Type.Object(
  {
    schemaVersion: SchemaVersionSchema,
    kind: Type.Literal("constraints"),
    id: IdSchema,
    rigId: IdSchema,
    constraints: Type.Array(ConstraintSchema),
  },
  { $id: "ConstraintSpec-0.1", additionalProperties: false },
);

export type IkConstraint = Static<typeof IkConstraintSchema>;
export type TransformConstraint = Static<typeof TransformConstraintSchema>;
export type PathConstraint = Static<typeof PathConstraintSchema>;
export type ConstraintSpec = Static<typeof ConstraintSpecSchema>;
