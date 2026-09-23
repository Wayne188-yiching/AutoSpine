import type { TSchema } from "@sinclair/typebox";

import { AnimationSpecSchema } from "./animation-spec.js";
import { AssetSpecSchema } from "./asset-spec.js";
import { BuildManifestSchema } from "./build-manifest.js";
import { ConstraintSpecSchema } from "./constraint-spec.js";
import { MeshSpecSchema } from "./mesh-spec.js";
import { RigSpecSchema } from "./rig-spec.js";
import { ValidationReportSchema } from "./validation-report.js";
import { WeightSpecSchema } from "./weight-spec.js";

export const SPEC_SCHEMAS = Object.freeze({
  AssetSpec: AssetSpecSchema,
  MeshSpec: MeshSpecSchema,
  RigSpec: RigSpecSchema,
  WeightSpec: WeightSpecSchema,
  ConstraintSpec: ConstraintSpecSchema,
  AnimationSpec: AnimationSpecSchema,
  BuildManifest: BuildManifestSchema,
  ValidationReport: ValidationReportSchema,
}) satisfies Readonly<Record<string, TSchema>>;
