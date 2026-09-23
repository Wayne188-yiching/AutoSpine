import { Type, type Static } from "@sinclair/typebox";

import { IdSchema, NameSchema, SchemaVersionSchema } from "./common.js";

export const BoneSpecSchema = Type.Object(
  {
    id: IdSchema,
    name: NameSchema,
    parentId: Type.Optional(IdSchema),
    x: Type.Number(),
    y: Type.Number(),
    rotation: Type.Number(),
    length: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const RigSpecSchema = Type.Object(
  {
    schemaVersion: SchemaVersionSchema,
    kind: Type.Literal("rig"),
    id: IdSchema,
    name: NameSchema,
    type: Type.Union([
      Type.Literal("chain"),
      Type.Literal("humanoid"),
      Type.Literal("prop"),
      Type.Literal("custom"),
    ]),
    bones: Type.Array(BoneSpecSchema, { minItems: 1 }),
  },
  { $id: "RigSpec-0.1", additionalProperties: false },
);

export type BoneSpec = Static<typeof BoneSpecSchema>;
export type RigSpec = Static<typeof RigSpecSchema>;
