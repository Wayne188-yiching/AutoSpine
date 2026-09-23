import { Type, type Static } from "@sinclair/typebox";

import {
  BoundsSchema,
  IdSchema,
  NameSchema,
  SchemaVersionSchema,
  Vector2Schema,
} from "./common.js";

export const AssetPartSchema = Type.Object(
  {
    id: IdSchema,
    name: NameSchema,
    sourcePath: Type.String({ minLength: 1 }),
    parentId: Type.Optional(IdSchema),
    bounds: BoundsSchema,
    pivotCandidate: Type.Optional(Vector2Schema),
    drawOrder: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const AssetSpecSchema = Type.Object(
  {
    schemaVersion: SchemaVersionSchema,
    kind: Type.Literal("asset"),
    id: IdSchema,
    name: NameSchema,
    source: Type.Object(
      {
        type: Type.Union([Type.Literal("png-parts"), Type.Literal("psd")]),
        path: Type.String({ minLength: 1 }),
      },
      { additionalProperties: false },
    ),
    width: Type.Number({ exclusiveMinimum: 0 }),
    height: Type.Number({ exclusiveMinimum: 0 }),
    parts: Type.Array(AssetPartSchema, { minItems: 1 }),
  },
  { $id: "AssetSpec-0.1", additionalProperties: false },
);

export type AssetPart = Static<typeof AssetPartSchema>;
export type AssetSpec = Static<typeof AssetSpecSchema>;
