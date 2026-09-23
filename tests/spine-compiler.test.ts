import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AtlasAttachmentLoader, SkeletonJson, TextureAtlas } from "@esotericsoftware/spine-core";
import { describe, expect, it } from "vitest";

import {
  SpineCompileError,
  compileSpine40,
  validateMinimalSpineInput,
  validateSpine40,
  type MinimalSpineInput,
} from "@autospine/spine";

const fixtureRoot = resolve(process.cwd(), "fixtures/spine/minimal");
const editorExport = JSON.parse(readFileSync(resolve(fixtureRoot, "export/minimal.json"), "utf8"));
const atlasText = readFileSync(resolve(fixtureRoot, "export/minimal-4.0.64.atlas"), "utf8");

// The intentionally child-first IR fixture exercises parent-first compiler ordering.
const input = JSON.parse(
  readFileSync(resolve(fixtureRoot, "input.json"), "utf8"),
) as MinimalSpineInput;

describe("Gate 1 Spine 4.0.64 compiler", () => {
  it("matches the supported semantics of a real editor export", () => {
    const essentialSkeleton = { ...editorExport.skeleton };
    delete essentialSkeleton.hash;
    delete essentialSkeleton.audio;
    expect(compileSpine40(input)).toEqual({ ...editorExport, skeleton: essentialSkeleton });
    const compiledFixture = JSON.parse(readFileSync(resolve(fixtureRoot, "compiled.json"), "utf8"));
    expect(JSON.stringify(compileSpine40(input))).toBe(JSON.stringify(compiledFixture));
    expect(validateSpine40(compileSpine40(input)).status).toBe("passed");
  });

  it("loads in the official 4.0 runtime with the editor-exported atlas", () => {
    const atlas = new TextureAtlas(atlasText);
    const skeleton = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(
      compileSpine40(input),
    );
    expect(skeleton.bones.map((bone) => bone.name)).toEqual(["root", "child"]);
    expect(skeleton.bones[1]?.x).toBe(8);
    expect(skeleton.bones[1]?.y).toBe(12);
    expect(skeleton.slots[0]?.attachmentName).toBe("square");
    expect(skeleton.animations[0]?.duration).toBe(1);
  });

  it("serializes identically over 100 runs", () => {
    const expected = JSON.stringify(compileSpine40(input));
    for (let run = 0; run < 100; run++)
      expect(JSON.stringify(compileSpine40(input))).toBe(expected);
  });

  it("reports bad references and unsupported input explicitly", () => {
    const bad: MinimalSpineInput = { ...input, binding: { ...input.binding, boneId: "missing" } };
    expect(validateMinimalSpineInput(bad).issues.map((item) => item.code)).toContain(
      "BONE_REFERENCE",
    );
    expect(() => compileSpine40(bad)).toThrow(SpineCompileError);
    expect(
      validateSpine40({ ...compileSpine40(input), skeleton: { spine: "4.3" } }).issues[0]?.code,
    ).toBe("VERSION");
    expect(validateMinimalSpineInput(null as unknown as MinimalSpineInput).issues[0]?.code).toBe(
      "INPUT",
    );
  });
});
