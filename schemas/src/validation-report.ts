import { Type, type Static } from "@sinclair/typebox";

import { IdSchema, SchemaVersionSchema } from "./common.js";

export const ValidationStageSchema = Type.Union([
  Type.Literal("asset"),
  Type.Literal("mesh"),
  Type.Literal("rig"),
  Type.Literal("weights"),
  Type.Literal("constraints"),
  Type.Literal("animation"),
  Type.Literal("spine"),
  Type.Literal("build"),
]);

export const ValidationIssueSchema = Type.Object(
  {
    code: Type.String({ minLength: 1 }),
    stage: ValidationStageSchema,
    target: Type.Optional(Type.String({ minLength: 1 })),
    severity: Type.Integer({ minimum: 0, maximum: 3 }),
    reason: Type.String({ minLength: 1 }),
    possibleAction: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export const ValidationReportSchema = Type.Object(
  {
    schemaVersion: SchemaVersionSchema,
    kind: Type.Literal("validation-report"),
    id: IdSchema,
    status: Type.Union([Type.Literal("passed"), Type.Literal("warning"), Type.Literal("error")]),
    issues: Type.Array(ValidationIssueSchema),
  },
  { $id: "ValidationReport-0.1", additionalProperties: false },
);

export type ValidationStage = Static<typeof ValidationStageSchema>;
export type ValidationIssue = Static<typeof ValidationIssueSchema>;
export type ValidationReport = Static<typeof ValidationReportSchema>;
