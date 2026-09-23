import { Type, type Static } from "@sinclair/typebox";

import { IdSchema, NameSchema, SchemaVersionSchema, Vector2Schema } from "./common.js";

export const MeshSpecSchema = Type.Object(
  {
    schemaVersion: SchemaVersionSchema,
    kind: Type.Literal("mesh"),
    id: IdSchema,
    name: NameSchema,
    sourcePartId: IdSchema,
    vertices: Type.Array(Vector2Schema, { minItems: 3 }),
    uvs: Type.Array(Vector2Schema, { minItems: 3 }),
    triangles: Type.Array(Type.Integer({ minimum: 0 }), { minItems: 3 }),
    hull: Type.Array(Type.Integer({ minimum: 0 }), { minItems: 3 }),
  },
  { $id: "MeshSpec-0.1", additionalProperties: false },
);

export type MeshSpec = Static<typeof MeshSpecSchema>;
