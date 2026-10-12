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
  it("keeps character orchestration pure and the Spine runtime in the reference layer (ADR-017)", () => {
    const deps = (name: string) =>
      Object.keys(
        (
          JSON.parse(readFileSync(resolve(`packages/${name}/package.json`), "utf8")) as {
            dependencies: Record<string, string>;
          }
        ).dependencies,
      ).sort();
    const sources = (name: string) =>
      readdirSync(resolve(`packages/${name}/src`))
        .filter((f) => f.endsWith(".ts"))
        .map((f) => readFileSync(resolve(`packages/${name}/src`, f), "utf8"))
        .join("\n");
    expect(deps("character")).toEqual([
      "@autospine/assets",
      "@autospine/mesh",
      "@autospine/motion",
      "@autospine/rig",
      "@autospine/schemas",
      "@autospine/spine",
      "@autospine/weights",
    ]);
    // No filesystem, no runtime, no planner/AI: plan + layout in, IR and Spine JSON out.
    expect(sources("character")).not.toMatch(
      /node:|spine-core|@autospine\/(planning|reference|cli|mcp|core)/,
    );
    expect(deps("reference")).toEqual([
      "@autospine/character",
      "@autospine/planning",
      "@autospine/schemas",
      "@esotericsoftware/spine-core",
    ]);
    // The official runtime is pinned: comparisons must not move with a caret update.
    expect(
      (
        JSON.parse(readFileSync(resolve("packages/reference/package.json"), "utf8")) as {
          dependencies: Record<string, string>;
        }
      ).dependencies["@esotericsoftware/spine-core"],
    ).toBe("4.0.31");
    expect(sources("reference")).not.toMatch(/@autospine\/(cli|mcp)|writeFile/);
  });
  it("exposes the shared IR through core", () => {
    expect(Object.keys(SPEC_SCHEMAS)).toHaveLength(8);
  });

  it("keeps the Spine 4.0.64 compiler in the adapter package", () => {
    expect(spine.SPINE_COMPATIBILITY_TARGET).toBe("4.0.64");
    expect(spine.compileSpine40).toBeTypeOf("function");
  });
});
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
