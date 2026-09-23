import { Type } from "@sinclair/typebox";

export const SCHEMA_VERSION = "0.1" as const;

export const SchemaVersionSchema = Type.Literal(SCHEMA_VERSION);
export const IdSchema = Type.String({ minLength: 1 });
export const NameSchema = Type.String({ minLength: 1 });
export const Vector2Schema = Type.Tuple([Type.Number(), Type.Number()]);

export const BoundsSchema = Type.Object(
  {
    x: Type.Number(),
    y: Type.Number(),
    width: Type.Number({ minimum: 0 }),
    height: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const SpecReferenceSchema = Type.Object(
  {
    id: IdSchema,
    schemaVersion: SchemaVersionSchema,
  },
  { additionalProperties: false },
);
