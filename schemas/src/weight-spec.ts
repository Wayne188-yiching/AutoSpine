import { Type, type Static } from "@sinclair/typebox";

import { IdSchema, SchemaVersionSchema } from "./common.js";

export const BoneInfluenceSchema = Type.Object(
  {
    boneId: IdSchema,
    weight: Type.Number({ minimum: 0, maximum: 1 }),
  },
  { additionalProperties: false },
);

export const VertexWeightSchema = Type.Object(
  {
    vertexIndex: Type.Integer({ minimum: 0 }),
    influences: Type.Array(BoneInfluenceSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export const WeightSpecSchema = Type.Object(
  {
    schemaVersion: SchemaVersionSchema,
    kind: Type.Literal("weights"),
    id: IdSchema,
    meshId: IdSchema,
    rigId: IdSchema,
    vertices: Type.Array(VertexWeightSchema),
  },
  { $id: "WeightSpec-0.1", additionalProperties: false },
);

export type BoneInfluence = Static<typeof BoneInfluenceSchema>;
export type VertexWeight = Static<typeof VertexWeightSchema>;
export type WeightSpec = Static<typeof WeightSpecSchema>;
