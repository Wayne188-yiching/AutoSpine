import { it, expect } from "vitest";
import type { RigSpec, ConstraintSpec } from "@autospine/schemas";
import { solveConstraints } from "@autospine/constraints";
import { evaluateRig, transformPoint } from "@autospine/rig";
const rig: RigSpec = {
  schemaVersion: "0.1",
  kind: "rig",
  id: "rig",
  name: "Constraint test",
  type: "custom",
  bones: [
    { id: "a", name: "a", x: 0, y: 0, rotation: 0, length: 10 },
    { id: "b", name: "b", parentId: "a", x: 10, y: 0, rotation: 0, length: 10 },
    { id: "target", name: "target", x: 10, y: 10, rotation: 45, length: 0 },
  ],
};
const ik: ConstraintSpec = {
  schemaVersion: "0.1",
  kind: "constraints",
  id: "ik",
  rigId: rig.id,
  constraints: [
    {
      id: "ik",
      name: "IK",
      type: "ik",
      boneIds: ["a", "b"],
      targetBoneId: "target",
      mix: 1,
      bendDirection: "positive",
    },
  ],
};
it("Gate 13 analytical two-bone IK reaches known target and preserves lengths and input", () => {
  const before = JSON.stringify(rig),
    result = solveConstraints(rig, ik);
  expect(result.diagnostics[0]!.reachable).toBe(true);
  const tip = transformPoint(evaluateRig(result.rig).get("b")!, [10, 0]);
  expect(tip[0]).toBeCloseTo(10, 10);
  expect(tip[1]).toBeCloseTo(10, 10);
  expect(JSON.stringify(rig)).toBe(before);
  for (let i = 0; i < 100; i++) expect(solveConstraints(rig, ik)).toEqual(result);
});
it("Gate 13 unreachable and folded IK are finite, mix zero leaves setup intact", () => {
  for (const x of [0, 100]) {
    const source = structuredClone(rig);
    source.bones[2]!.x = x;
    source.bones[2]!.y = 0;
    const result = solveConstraints(source, ik);
    expect(Number.isFinite(result.diagnostics[0]!.residual)).toBe(true);
    expect(result.diagnostics[0]!.reachable).toBe(x === 0);
  }
  const spec = structuredClone(ik);
  if (spec.constraints[0]!.type === "ik") spec.constraints[0]!.mix = 0;
  const result = solveConstraints(rig, spec);
  expect(result.rig).toEqual(rig);
});
it("Gate 13 single-bone and opposite bend directions have independent numeric oracles", () => {
  const single = structuredClone(ik);
  single.constraints[0]!.boneIds = ["a"];
  const source = structuredClone(rig);
  source.bones[2]!.x = 0;
  source.bones[2]!.y = 10;
  expect(solveConstraints(source, single).diagnostics[0]!.reachable).toBe(true);
  const negative = structuredClone(ik);
  if (negative.constraints[0]!.type === "ik") negative.constraints[0]!.bendDirection = "negative";
  const result = solveConstraints(rig, negative);
  expect(result.diagnostics[0]!.reachable).toBe(true);
  expect(result.rig.bones[1]!.rotation).toBeCloseTo(-90, 10);
});
it("Gate 13 transform local copy and arc-length polyline following perform actual motion", () => {
  const transform: ConstraintSpec = {
    ...ik,
    id: "copy",
    constraints: [
      {
        id: "copy",
        name: "Copy",
        type: "transform",
        boneIds: ["a"],
        targetBoneId: "target",
        local: true,
        relative: false,
        rotateMix: 1,
        translateMix: 1,
        scaleMix: 1,
        shearMix: 1,
      },
    ],
  };
  const copied = solveConstraints(rig, transform).rig;
  expect(copied.bones[0]).toMatchObject({ x: 10, y: 10, rotation: 45 });
  const path: ConstraintSpec = {
    ...ik,
    id: "path",
    constraints: [
      {
        id: "path",
        name: "Path",
        type: "path",
        boneIds: ["a", "b"],
        targetPathId: "curve",
        position: 5,
        spacing: 10,
        rotateMix: 1,
        translateMix: 1,
      },
    ],
  };
  const result = solveConstraints(rig, path, {
    curve: [
      [0, 0],
      [10, 0],
      [10, 20],
    ],
  });
  const frames = evaluateRig(result.rig);
  expect(transformPoint(frames.get("a")!, [0, 0])[0]).toBeCloseTo(5, 10);
  expect(transformPoint(frames.get("b")!, [0, 0])[1]).toBeCloseTo(5, 10);
});
it("Gate 13 rejects feedback targets, competing constraints, missing paths and unsupported affine IK", () => {
  const cycle = structuredClone(ik);
  if (cycle.constraints[0]!.type === "ik") cycle.constraints[0]!.targetBoneId = "b";
  expect(() => solveConstraints(rig, cycle)).toThrow();
  expect(() =>
    solveConstraints({ ...rig, bones: rig.bones.map((b) => ({ ...b, scaleX: 2 })) }, ik),
  ).toThrow(/unit-scale/);
  const duplicate = {
    ...ik,
    constraints: [ik.constraints[0]!, { ...ik.constraints[0]!, id: "another" }],
  };
  expect(() => solveConstraints(rig, duplicate)).toThrow(/competing/);
  expect(() => solveConstraints(rig, { ...ik, rigId: "foreign" })).toThrow();
  const path: ConstraintSpec = {
    ...ik,
    constraints: [
      {
        id: "path",
        name: "path",
        type: "path",
        boneIds: ["a"],
        targetPathId: "path",
        position: 0,
        spacing: 0,
        rotateMix: 1,
        translateMix: 1,
      },
    ],
  };
  expect(() => solveConstraints(rig, path)).toThrow(/polyline/);
  const transform: ConstraintSpec = {
    ...ik,
    constraints: [
      {
        id: "copy",
        name: "copy",
        type: "transform",
        boneIds: ["a"],
        targetBoneId: "target",
        local: false,
        relative: false,
        rotateMix: 1,
        translateMix: 1,
        scaleMix: 1,
        shearMix: 1,
      },
    ],
  };
  expect(() => solveConstraints(rig, transform)).toThrow(/local absolute/);
});
