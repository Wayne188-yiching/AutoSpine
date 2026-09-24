import { describe, expect, it } from "vitest";

import { SPEC_SCHEMAS } from "@autospine/core";
import * as spine from "@autospine/spine";

describe("Gate 0 package boundaries", () => {
  it("keeps artist-reference geometry in the engine-neutral Mesh package", () => {
    const meshPackage = JSON.parse(readFileSync(resolve("packages/mesh/package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    const meshConfig = JSON.parse(readFileSync(resolve("packages/mesh/tsconfig.json"), "utf8")) as {
      references: { path: string }[];
    };
    const meshSource = readFileSync(resolve("packages/mesh/src/generate.ts"), "utf8");
    expect(Object.keys(meshPackage.dependencies).sort()).toEqual([
      "@autospine/schemas",
      "@sinclair/typebox",
      "earcut",
    ]);
    expect(meshConfig.references).toEqual([{ path: "../../schemas" }]);
    expect(meshSource).not.toMatch(/@autospine\/(spine|assets|core)|typesafe|\.spine|SkeletonJson/);
  });
  it("keeps deterministic chain math independent of Spine, Mesh, assets, and AI", () => {
    const rigPackage = JSON.parse(readFileSync(resolve("packages/rig/package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    const rigSource = readFileSync(resolve("packages/rig/src/index.ts"), "utf8");
    expect(Object.keys(rigPackage.dependencies)).toEqual(["@autospine/schemas"]);
    expect(rigSource).not.toMatch(/@autospine\/(spine|mesh|assets|core)|typesafe|\.spine/);
  });
  it("exposes the shared IR through core", () => {
    expect(Object.keys(SPEC_SCHEMAS)).toHaveLength(8);
  });

  it("keeps the Spine 4.0.64 compiler in the adapter package", () => {
    expect(spine.SPINE_COMPATIBILITY_TARGET).toBe("4.0.64");
    expect(spine.compileSpine40).toBeTypeOf("function");
  });
});
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
