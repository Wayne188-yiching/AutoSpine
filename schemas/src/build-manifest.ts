import { Type, type Static } from "@sinclair/typebox";

import { IdSchema, SchemaVersionSchema, SpecReferenceSchema } from "./common.js";

export const BuildManifestSchema = Type.Object(
  {
    schemaVersion: SchemaVersionSchema,
    kind: Type.Literal("build-manifest"),
    id: IdSchema,
    asset: SpecReferenceSchema,
    mesh: Type.Optional(SpecReferenceSchema),
    rig: Type.Optional(SpecReferenceSchema),
    weights: Type.Optional(SpecReferenceSchema),
    constraints: Type.Optional(SpecReferenceSchema),
    animation: Type.Optional(SpecReferenceSchema),
    outputs: Type.Array(Type.String({ minLength: 1 })),
  },
  { $id: "BuildManifest-0.1", additionalProperties: false },
);

export type BuildManifest = Static<typeof BuildManifestSchema>;
