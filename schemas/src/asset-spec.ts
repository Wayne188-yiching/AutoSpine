import { Type, type Static } from "@sinclair/typebox";

import {
  BoundsSchema,
  IdSchema,
  NameSchema,
  SchemaVersionSchema,
  Vector2Schema,
} from "./common.js";
import { PartRoleSchema, PartSideSchema } from "./part-role.js";

export const AssetPartSchema = Type.Object(
  {
    id: IdSchema,
    name: NameSchema,
    sourcePath: Type.String({ minLength: 1 }),
    parentId: Type.Optional(IdSchema),
    bounds: BoundsSchema,
    pivotCandidate: Type.Optional(Vector2Schema),
    drawOrder: Type.Integer({ minimum: 0 }),
    /**
     * Caller-declared semantics. All three are optional: an asset parsed from PNG parts or a PSD
     * carries none of them, and labelling is a separate, explicit step (`applyPartLabels`).
     */
    role: Type.Optional(PartRoleSchema),
    side: Type.Optional(PartSideSchema),
    /** Id of the part this one follows (glow/outline over its base); not a parent in the tree. */
    rides: Type.Optional(IdSchema),
    visible: Type.Optional(Type.Boolean()),
    alphaMask: Type.Optional(
      Type.Object(
        {
          width: Type.Integer({ minimum: 1 }),
          height: Type.Integer({ minimum: 1 }),
          encoding: Type.Literal("rle8"),
          runs: Type.Array(Type.Integer({ minimum: 0 }), { minItems: 2 }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const AssetGroupSchema = Type.Object(
  {
    id: IdSchema,
    name: NameSchema,
    parentId: Type.Optional(IdSchema),
    visible: Type.Optional(Type.Boolean()),
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
    groups: Type.Optional(Type.Array(AssetGroupSchema)),
    parts: Type.Array(AssetPartSchema, { minItems: 1 }),
  },
  { $id: "AssetSpec-0.1", additionalProperties: false },
);

export type AssetPart = Static<typeof AssetPartSchema>;
export type AssetGroup = Static<typeof AssetGroupSchema>;
export type AssetSpec = Static<typeof AssetSpecSchema>;
