import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
  AssetSpecSchema,
  PartLabelMapSchema,
  PART_LABEL_PATTERN_MAX_LENGTH,
  PART_ROLES,
  SPEC_SCHEMAS,
  type AssetPart,
  type AssetSpec,
  type PartLabelMap,
} from "@autospine/schemas";
import { applyPartLabels, matchRidingParts, resolvePartLabels } from "@autospine/assets";
import { resolveRolePlan, roleDefaults } from "@autospine/weights";

const part = (
  id: string,
  name: string,
  bounds: [number, number, number, number],
  extra: Partial<AssetPart> = {},
): AssetPart => ({
  id,
  name,
  sourcePath: `${id}.png`,
  bounds: { x: bounds[0], y: bounds[1], width: bounds[2], height: bounds[3] },
  drawOrder: 0,
  ...extra,
});

const asset = (parts: AssetPart[]): AssetSpec => ({
  schemaVersion: "0.1",
  kind: "asset",
  id: "asset-synthetic",
  name: "Synthetic",
  source: { type: "png-parts", path: "fixtures/synthetic" },
  width: 256,
  height: 256,
  parts,
});

const labels = (overrides: Partial<PartLabelMap> = {}): PartLabelMap => ({
  schemaVersion: "0.1",
  kind: "part-labels",
  id: "labels-synthetic",
  patterns: [],
  ...overrides,
});

const code = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return (error as { validation?: { issues: { code: string }[] } }).validation?.issues[0]?.code;
  }
  return "no error";
};

describe("part label schema", () => {
  it("keeps role, side and rides optional so unlabelled assets still validate", () => {
    const plain = asset([part("p1", "Face", [0, 0, 10, 10])]);
    expect(Value.Check(AssetSpecSchema, plain)).toBe(true);
    expect("role" in plain.parts[0]!).toBe(false);
    const labelled = asset([
      part("p1", "Face", [0, 0, 10, 10], { role: "face", side: "c" }),
      part("p2", "Faces", [0, 0, 10, 10], { role: "glow", rides: "p1" }),
    ]);
    expect(Value.Check(AssetSpecSchema, labelled)).toBe(true);
  });

  it("rejects a role outside the declared vocabulary", () => {
    const bad = asset([part("p1", "Face", [0, 0, 10, 10], { role: "wing" as never })]);
    expect(Value.Check(AssetSpecSchema, bad)).toBe(false);
    expect(PART_ROLES).toContain("unknown");
    expect(new Set(PART_ROLES).size).toBe(PART_ROLES.length);
  });

  it("bounds authored pattern sources and stays out of the eight-document IR registry", () => {
    expect(
      Value.Check(
        PartLabelMapSchema,
        labels({
          patterns: [{ match: "x".repeat(PART_LABEL_PATTERN_MAX_LENGTH + 1), role: "face" }],
        }),
      ),
    ).toBe(false);
    // PartLabelMap is authoring-side input (like KeyposeSpec/MotionBrief), not a BuildManifest
    // document, so SPEC_SCHEMAS stays at the eight pipeline specs.
    expect(Object.keys(SPEC_SCHEMAS)).toHaveLength(8);
    expect(Object.keys(SPEC_SCHEMAS)).not.toContain("PartLabelMap");
    expect(PartLabelMapSchema.$id).toBe("PartLabelMap-0.1");
    expect(Object.values(SPEC_SCHEMAS).map((s) => s.$id)).not.toContain(PartLabelMapSchema.$id);
  });
});

describe("applyPartLabels", () => {
  const parts = [
    part("p1", "head_face", [0, 0, 10, 10]),
    part("p2", "arm_upper_l", [0, 0, 10, 10]),
    part("p3", "mystery_thing", [0, 0, 10, 10]),
    part("p4", "arm_upper_r", [0, 0, 10, 10]),
  ];
  const map = labels({
    patterns: [
      { match: "^arm_upper_l$", role: "upper-arm", side: "l" },
      { match: "^arm_upper", role: "upper-arm", side: "r" },
      { match: "face", role: "face", side: "c" },
    ],
    overrides: { p3: { role: "glow", rides: "p1" } },
  });

  it("lets the first matching pattern win and records its index", () => {
    const resolved = resolvePartLabels(asset(parts), map);
    expect(resolved[1]).toEqual({
      partId: "p2",
      role: "upper-arm",
      side: "l",
      source: "pattern",
      patternIndex: 0,
    });
    // p4 falls through to the broader second rule, proving order rather than specificity decides.
    expect(resolved[3]).toEqual({
      partId: "p4",
      role: "upper-arm",
      side: "r",
      source: "pattern",
      patternIndex: 1,
    });
  });

  it("gives overrides precedence over patterns", () => {
    const withPattern = labels({
      patterns: [{ match: "mystery", role: "torso" }],
      overrides: { p3: { role: "glow", side: "c", rides: "p1" } },
    });
    const resolved = resolvePartLabels(asset(parts), withPattern);
    expect(resolved[2]).toEqual({
      partId: "p3",
      role: "glow",
      side: "c",
      rides: "p1",
      source: "override",
    });
  });

  it("leaves unmatched parts unknown and never guesses", () => {
    const resolved = resolvePartLabels(asset(parts), labels({ patterns: [] }));
    expect(resolved.map((r) => r.role)).toEqual(["unknown", "unknown", "unknown", "unknown"]);
    expect(resolved.map((r) => r.source)).toEqual(Array(4).fill("unlabelled"));
    expect(resolved.every((r) => r.patternIndex === undefined)).toBe(true);
  });

  it("returns a new asset without mutating the input and is deterministic", () => {
    const input = asset(parts);
    const snapshot = structuredClone(input);
    const first = applyPartLabels(input, map);
    const second = applyPartLabels(input, map);
    expect(input).toEqual(snapshot);
    expect(first).not.toBe(input);
    expect(first).toEqual(second);
    expect(Value.Check(AssetSpecSchema, first)).toBe(true);
    expect(first.parts.map((p) => p.role)).toEqual(["face", "upper-arm", "glow", "upper-arm"]);
    expect(first.parts.map((p) => p.id)).toEqual(input.parts.map((p) => p.id));
    expect(first.parts[2]!.rides).toBe("p1");
  });

  it("matches the part name, not the id", () => {
    const resolved = resolvePartLabels(
      asset([part("head_face", "slot-7", [0, 0, 10, 10])]),
      labels({ patterns: [{ match: "head_face", role: "face" }] }),
    );
    expect(resolved[0]!.source).toBe("unlabelled");
  });

  it("applies opt-in case folding only when asked", () => {
    const parts2 = [part("p1", "HEAD_FACE", [0, 0, 10, 10])];
    expect(
      resolvePartLabels(
        asset(parts2),
        labels({ patterns: [{ match: "head_face", role: "face" }] }),
      )[0]!.role,
    ).toBe("unknown");
    expect(
      resolvePartLabels(
        asset(parts2),
        labels({ patterns: [{ match: "head_face", ignoreCase: true, role: "face" }] }),
      )[0]!.role,
    ).toBe("face");
  });

  it("blocks invalid, over-long and backtracking-prone patterns", () => {
    const run = (match: string) =>
      code(() => resolvePartLabels(asset(parts), labels({ patterns: [{ match, role: "face" }] })));
    expect(run("(unclosed")).toBe("PART_LABEL_PATTERN_SYNTAX");
    expect(run("[a-")).toBe("PART_LABEL_PATTERN_SYNTAX");
    expect(run("a)b")).toBe("PART_LABEL_PATTERN_SYNTAX");
    expect(run("(a+)+$")).toBe("PART_LABEL_PATTERN_NESTED_QUANTIFIER");
    expect(run("(x*)*")).toBe("PART_LABEL_PATTERN_NESTED_QUANTIFIER");
    expect(run("((((a))))")).toBe("no error");
    expect(run("(((((a)))))")).toBe("PART_LABEL_PATTERN_COMPLEXITY");
    expect(run("a+".repeat(17))).toBe("PART_LABEL_PATTERN_COMPLEXITY");
    // Over-length is caught by the document schema before any compilation happens.
    expect(run("x".repeat(PART_LABEL_PATTERN_MAX_LENGTH + 1))).toBe("PART_LABEL_MAP");
    // Escaped and character-class metacharacters are not counted as structure.
    expect(run("\\(a\\+\\)\\+[+*]")).toBe("no error");
  });

  it("rejects an invalid asset or label document", () => {
    expect(code(() => applyPartLabels({} as AssetSpec, labels()))).toBe("PART_LABEL_ASSET");
    expect(code(() => applyPartLabels(asset(parts), {} as PartLabelMap))).toBe("PART_LABEL_MAP");
  });
});

describe("resolveRolePlan", () => {
  it("covers every role in the vocabulary", () => {
    expect(Object.keys(roleDefaults).sort()).toEqual([...PART_ROLES].sort());
  });

  it("returns the documented starting values for the reference pipeline roles", () => {
    expect(resolveRolePlan("face")).toEqual({
      mesh: "feature",
      solver: "dome",
      params: { domePeak: 0.7, domeCounter: 0.1, pinMarginHeadWidthRatio: 0.12 },
      deferred: false,
    });
    expect(resolveRolePlan("forearm").params.chainWidthShorterBoneRatio).toBe(0.4);
    expect(resolveRolePlan("glow")).toMatchObject({
      mesh: "surface",
      solver: "transfer",
      params: { surfaceCellPx: 40 },
    });
    expect(resolveRolePlan("eyelid").solver).toBe("gradient");
    // Parts that only cover a joint keep their own bone instead of joining the chain.
    expect(resolveRolePlan("palm").solver).toBe("rigid");
  });

  it("defers rather than guesses for unlabelled parts", () => {
    expect(resolveRolePlan("unknown")).toEqual({
      mesh: "contour",
      solver: "rigid",
      params: {},
      deferred: true,
    });
  });

  it("merges per-role overrides key by key and leaves the defaults frozen", () => {
    const plan = resolveRolePlan("face", {
      face: { mesh: "surface", params: { domePeak: 0.55 } },
    });
    expect(plan).toEqual({
      mesh: "surface",
      solver: "dome",
      params: { domePeak: 0.55, domeCounter: 0.1, pinMarginHeadWidthRatio: 0.12 },
      deferred: false,
    });
    // An override for another role must not leak.
    expect(resolveRolePlan("glow", { face: { solver: "rigid" } }).solver).toBe("transfer");
    expect(roleDefaults.face.params.domePeak).toBe(0.7);
    expect(() => {
      (plan.params as { domePeak: number }).domePeak = 9;
    }).toThrow();
  });

  it("rejects unknown roles and malformed overrides", () => {
    expect(code(() => resolveRolePlan("wing" as never))).toBe("ROLE_PLAN_ROLE");
    expect(code(() => resolveRolePlan("face", { face: { mesh: "blob" as never } }))).toBe(
      "ROLE_PLAN_MESH",
    );
    expect(code(() => resolveRolePlan("face", { face: { solver: "magic" as never } }))).toBe(
      "ROLE_PLAN_SOLVER",
    );
    expect(code(() => resolveRolePlan("face", { face: { params: { domePeak: -1 } } }))).toBe(
      "ROLE_PLAN_PARAM",
    );
  });
});

describe("matchRidingParts", () => {
  it("prefers an explicit rides field", () => {
    const parts = [
      part("base", "halo", [0, 0, 10, 10]),
      part("other", "halos", [0, 0, 10, 10]),
      part("rider", "glow_thing", [100, 100, 10, 10], { role: "glow", rides: "base" }),
    ];
    expect(matchRidingParts(parts)).toEqual([
      { target: "rider", source: "base", reason: "explicit", score: 1 },
    ]);
  });

  it("falls back to the configured name convention", () => {
    const parts = [
      part("base", "halo", [0, 0, 10, 10]),
      part("rider", "halos", [200, 200, 10, 10], { role: "glow" }),
    ];
    expect(matchRidingParts(parts)).toEqual([
      { target: "rider", source: "base", reason: "name", score: 1 },
    ]);
    // The suffix list is data: a project with another convention supplies its own.
    const other = [
      part("base", "arm", [0, 0, 10, 10]),
      part("rider", "arm_hikari", [200, 200, 10, 10], { role: "glow" }),
    ];
    expect(matchRidingParts(other)).toEqual([]);
    expect(matchRidingParts(other, { suffixes: ["_hikari"] })).toEqual([
      { target: "rider", source: "base", reason: "name", score: 1 },
    ]);
  });

  it("falls back to the largest world bbox overlap", () => {
    const parts = [
      part("far", "torso", [100, 100, 10, 10]),
      part("near", "head", [0, 0, 10, 10]),
      part("rider", "sparkle", [0, 0, 10, 20], { role: "glow" }),
    ];
    expect(matchRidingParts(parts)).toEqual([
      { target: "rider", source: "near", reason: "overlap", score: 0.5 },
    ]);
  });

  it("breaks overlap ties by ascending part id", () => {
    const parts = [
      part("zz", "torso", [0, 0, 10, 10]),
      part("aa", "head", [0, 0, 10, 10]),
      part("rider", "sparkle", [0, 0, 10, 10], { role: "glow" }),
    ];
    const matches = matchRidingParts(parts);
    expect(matches).toEqual([{ target: "rider", source: "aa", reason: "overlap", score: 1 }]);
    // Reversing the input order must not change the winner.
    expect(matchRidingParts([...parts].reverse())).toEqual(matches);
  });

  it("returns nothing rather than forcing a pair", () => {
    const parts = [
      part("base", "torso", [0, 0, 10, 10]),
      part("rider", "sparkle", [500, 500, 10, 10], { role: "glow" }),
    ];
    expect(matchRidingParts(parts)).toEqual([]);
    expect(matchRidingParts(parts, { minOverlap: 0 })).toEqual([
      { target: "rider", source: "base", reason: "overlap", score: 0 },
    ]);
    // Non-rider parts are never paired, however much they overlap.
    expect(
      matchRidingParts([part("a", "x", [0, 0, 10, 10]), part("b", "y", [0, 0, 10, 10])]),
    ).toEqual([]);
  });

  it("sorts output by target id and rejects broken references", () => {
    const parts = [
      part("base", "torso", [0, 0, 10, 10]),
      part("zz-rider", "zz", [0, 0, 10, 10], { role: "glow" }),
      part("aa-rider", "aa", [0, 0, 10, 10], { role: "glow" }),
    ];
    expect(matchRidingParts(parts).map((m) => m.target)).toEqual(["aa-rider", "zz-rider"]);
    expect(code(() => matchRidingParts([part("r", "r", [0, 0, 1, 1], { rides: "missing" })]))).toBe(
      "RIDING_UNRESOLVED",
    );
    expect(code(() => matchRidingParts([part("r", "r", [0, 0, 1, 1], { rides: "r" })]))).toBe(
      "RIDING_UNRESOLVED",
    );
    expect(code(() => matchRidingParts([], { minOverlap: 2 }))).toBe("RIDING_OPTIONS");
    expect(
      code(() => matchRidingParts([part("a", "a", [0, 0, 1, 1]), part("a", "b", [0, 0, 1, 1])])),
    ).toBe("RIDING_PART_IDS");
  });
});
