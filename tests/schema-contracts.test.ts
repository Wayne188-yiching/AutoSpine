import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  AnimationSpecSchema,
  AssetSpecSchema,
  BuildManifestSchema,
  ConstraintSpecSchema,
  MeshSpecSchema,
  RigSpecSchema,
  SPEC_SCHEMAS,
  ValidationReportSchema,
  WeightSpecSchema,
  type AnimationSpec,
  type AssetSpec,
  type BuildManifest,
  type ConstraintSpec,
  type MeshSpec,
  type RigSpec,
  type ValidationReport,
  type WeightSpec,
} from "@autospine/schemas";

const asset = {
  schemaVersion: "0.1",
  kind: "asset",
  id: "asset-tail",
  name: "Tail",
  source: { type: "png-parts", path: "fixtures/tail" },
  width: 512,
  height: 256,
  parts: [
    {
      id: "tail-part",
      name: "Tail",
      sourcePath: "tail.png",
      bounds: { x: 0, y: 0, width: 512, height: 256 },
      pivotCandidate: [16, 128],
      drawOrder: 0,
    },
  ],
} satisfies AssetSpec;

const mesh = {
  schemaVersion: "0.1",
  kind: "mesh",
  id: "mesh-tail",
  name: "Tail mesh",
  sourcePartId: "tail-part",
  vertices: [
    [0, 0],
    [512, 0],
    [0, 256],
  ],
  uvs: [
    [0, 0],
    [1, 0],
    [0, 1],
  ],
  triangles: [0, 1, 2],
  hull: [0, 1, 2],
} satisfies MeshSpec;

const rig = {
  schemaVersion: "0.1",
  kind: "rig",
  id: "rig-tail",
  name: "Tail rig",
  type: "chain",
  bones: [
    { id: "root", name: "Root", x: 0, y: 0, rotation: 0, length: 0 },
    {
      id: "tail-1",
      name: "Tail 1",
      parentId: "root",
      x: 0,
      y: 0,
      rotation: 0,
      length: 128,
    },
  ],
} satisfies RigSpec;

const weights = {
  schemaVersion: "0.1",
  kind: "weights",
  id: "weights-tail",
  meshId: mesh.id,
  rigId: rig.id,
  vertices: [{ vertexIndex: 0, influences: [{ boneId: "tail-1", weight: 1 }] }],
} satisfies WeightSpec;

const constraints = {
  schemaVersion: "0.1",
  kind: "constraints",
  id: "constraints-tail",
  rigId: rig.id,
  constraints: [],
} satisfies ConstraintSpec;

const animation = {
  schemaVersion: "0.1",
  kind: "animation",
  id: "animation-tail-idle",
  name: "Tail idle",
  rigId: rig.id,
  duration: 2,
  loop: true,
  seed: 42,
  motions: [],
} satisfies AnimationSpec;

const manifest = {
  schemaVersion: "0.1",
  kind: "build-manifest",
  id: "build-tail",
  asset: { id: asset.id, schemaVersion: "0.1" },
  mesh: { id: mesh.id, schemaVersion: "0.1" },
  rig: { id: rig.id, schemaVersion: "0.1" },
  weights: { id: weights.id, schemaVersion: "0.1" },
  constraints: { id: constraints.id, schemaVersion: "0.1" },
  animation: { id: animation.id, schemaVersion: "0.1" },
  outputs: [],
} satisfies BuildManifest;

const report = {
  schemaVersion: "0.1",
  kind: "validation-report",
  id: "validation-tail",
  status: "passed",
  issues: [],
} satisfies ValidationReport;

const validDocuments = [
  [AssetSpecSchema, asset],
  [MeshSpecSchema, mesh],
  [RigSpecSchema, rig],
  [WeightSpecSchema, weights],
  [ConstraintSpecSchema, constraints],
  [AnimationSpecSchema, animation],
  [BuildManifestSchema, manifest],
  [ValidationReportSchema, report],
] as const;

describe("AutoSpine IR schema contracts", () => {
  it.each(validDocuments)("accepts a valid %s document", (schema, value) => {
    expect(Value.Check(schema, value)).toBe(true);
  });

  it("rejects unknown properties", () => {
    expect(Value.Check(AssetSpecSchema, { ...asset, unexpected: true })).toBe(false);
  });

  it("rejects an out-of-range bone influence", () => {
    const invalidWeights = structuredClone(weights) as WeightSpec;
    invalidWeights.vertices[0]!.influences[0]!.weight = 1.1;
    expect(Value.Check(WeightSpecSchema, invalidWeights)).toBe(false);
  });

  it("registers JSON-serializable schemas with unique ids", () => {
    const ids = Object.values(SPEC_SCHEMAS).map((schema) => schema.$id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(() => JSON.stringify(SPEC_SCHEMAS)).not.toThrow();
  });
});
