import { Type, type Static } from "@sinclair/typebox";
import { IdSchema, NameSchema, SchemaVersionSchema, Vector2Schema } from "./common.js";

/** Outer file/tool contract, deliberately separate from the eight engine IR schemas. */
export const BuildJobSchema = Type.Object(
  {
    schemaVersion: SchemaVersionSchema,
    kind: Type.Literal("build-job"),
    id: IdSchema,
    name: NameSchema,
    profile: Type.Literal("chain-wave"),
    source: Type.String({ minLength: 1 }),
    output: Type.String({ minLength: 1 }),
    cleanupFraction: Type.Number({ minimum: 0, maximum: 0.02 }),
    chain: Type.Object(
      {
        start: Vector2Schema,
        end: Vector2Schema,
        boneCount: Type.Integer({ minimum: 2, maximum: 64 }),
      },
      { additionalProperties: false },
    ),
    wave: Type.Object(
      {
        duration: Type.Number({ exclusiveMinimum: 0, maximum: 10 }),
        fps: Type.Integer({ minimum: 1, maximum: 60 }),
        amplitudeDegrees: Type.Number({ minimum: 0, maximum: 45 }),
        phaseDegrees: Type.Number({ minimum: -180, maximum: 180 }),
      },
      { additionalProperties: false },
    ),
  },
  { $id: "BuildJob-0.1", additionalProperties: false },
);
export type BuildJob = Static<typeof BuildJobSchema>;
