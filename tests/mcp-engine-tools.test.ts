import { describe, expect, it } from "vitest";
import { readdir } from "node:fs/promises";
import type { AssetPart, KeyposeSpec, MeshSpec, WeightSpec } from "@autospine/schemas";
import { encodeAlphaMask } from "@autospine/assets";
import { generateSurfaceMesh } from "@autospine/mesh";
import { rigFromWorldFrames } from "@autospine/rig";
import { AutoSpineMcpServer, mcpTools } from "@autospine/mcp";
import { solveChainWeights } from "@autospine/weights";

interface Reply {
  error?: { code: number; message: string };
  result?: { isError?: boolean; structuredContent?: Record<string, unknown> };
}
const engineTools = [
  "autospine_build_keypose_animation",
  "autospine_feature_mesh",
  "autospine_measure_dome",
  "autospine_dome_weights",
  "autospine_transfer_weights",
  "autospine_chain_weights",
  "autospine_gradient_weights",
  "autospine_measure_overlap",
];
async function ready() {
  const server = new AutoSpineMcpServer(process.cwd());
  await server.receive({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test-host", version: "1" },
    },
  });
  await server.receive({ jsonrpc: "2.0", method: "notifications/initialized" });
  return server;
}
// Arguments travel as JSON, exactly as a host sends them.
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
async function call(server: AutoSpineMcpServer, name: string, args: unknown) {
  const reply = (await server.receive({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name, arguments: json(args) },
  })) as Reply;
  expect(reply.error).toBeUndefined();
  return reply.result!;
}
const ok = async (server: AutoSpineMcpServer, name: string, args: unknown) => {
  const r = await call(server, name, args);
  expect(r.isError, JSON.stringify(r.structuredContent)).not.toBe(true);
  return r.structuredContent!;
};
const failure = async (server: AutoSpineMcpServer, name: string, args: unknown) => {
  const r = await call(server, name, args);
  expect(r.isError).toBe(true);
  const body = r.structuredContent as {
    code?: string;
    validation?: { issues: { code: string }[] };
  };
  return body.code ?? body.validation?.issues[0]?.code;
};

const rig = rigFromWorldFrames("mcp", "MCP rig", [
  { id: "root", name: "root", length: 0, world: [1, 0, 0, 1, 0, 0] },
  { id: "b1", name: "b1", parentId: "root", length: 30, world: [1, 0, 0, 1, 0, 0] },
  { id: "b2", name: "b2", parentId: "b1", length: 30, world: [1, 0, 0, 1, 30, 0] },
  { id: "b3", name: "b3", parentId: "b2", length: 20, world: [1, 0, 0, 1, 60, 0] },
  { id: "ctrl", name: "ctrl", parentId: "root", length: 0, world: [1, 0, 0, 1, 40, 0] },
  { id: "back", name: "back", parentId: "root", length: 0, world: [1, 0, 0, 1, 40, 0] },
]);
const grid = (id: string, x: number, y: number, width: number, height: number) =>
  generateSurfaceMesh(
    {
      id,
      name: id,
      sourcePath: id + ".png",
      bounds: { x, y, width, height },
      drawOrder: 0,
    } as AssetPart,
    width / 5,
    height / 3,
  );
const tail = grid("tail", 0, -3, 80, 6),
  glow = grid("glow", -5, -6, 90, 12);
const tailWeights = solveChainWeights(tail, rig, ["b1", "b2", "b3"], 8);

// A face-like part with two sockets, as in tests/feature-mesh.test.ts.
const width = 120,
  height = 80,
  alpha = new Uint8Array(width * height);
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++) {
    const [px, py] = [x + 0.5, y + 0.5];
    const face = ((px - 60) / 55) ** 2 + ((py - 40) / 36) ** 2 <= 1;
    const socket = [40, 80].some((cx) => ((px - cx) / 11) ** 2 + ((py - 35) / 7) ** 2 <= 1);
    if (face && !socket) alpha[y * width + x] = 255;
  }
const facePart: AssetPart = {
  id: "face",
  name: "Face",
  sourcePath: "face.png",
  bounds: { x: 0, y: 0, width, height },
  drawOrder: 0,
  alphaMask: encodeAlphaMask(width, height, alpha),
};

describe("MCP engine tools (ADR-010..016)", () => {
  it("lists every engine tool as read-only with a strict schema", () => {
    for (const name of engineTools) {
      const tool = mcpTools.find((t) => t.name === name)!;
      expect(tool, name).toBeDefined();
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });

  it("reports the engine capabilities in status", async () => {
    const status = await ok(await ready(), "autospine_get_status", {});
    expect(status.capabilities).toMatchObject({
      keyCurves: "linear-stepped-bezier-per-key",
      keyposeGrammar: "beats-follow-saccade-settle-cycle",
      featureMesh: "silhouette-hull-and-hole-rings",
      artistQualityAccepted: false,
    });
  });

  it("compiles a pose table with a follow rule into curved keys", async () => {
    const server = await ready();
    const spec: KeyposeSpec = {
      schemaVersion: "0.1",
      kind: "keypose-spec",
      id: "wag",
      name: "wag",
      rigId: rig.id,
      fps: 30,
      frames: 60,
      loop: true,
      controls: [
        { id: "t1", boneId: "b1", channel: "rotate" },
        { id: "t2", boneId: "b2", channel: "rotate" },
      ],
      beats: [
        { frame: 0, poses: { t1: 0 } },
        { frame: 15, ease: "out", poses: { t1: 12 } },
        { frame: 40, poses: { t1: -8 } },
      ],
      rules: [{ rule: "follow", control: "t2", source: "t1", lag: 4, gain: 1.5 }],
    };
    const out = (await ok(server, "autospine_build_keypose_animation", { rig, spec })) as {
      animation: { rotationTimelines: { boneId: string; keys: { curve?: unknown }[] }[] };
      keyCount: number;
      artistQualityAccepted: boolean;
    };
    expect(out.artistQualityAccepted).toBe(false);
    expect(out.animation.rotationTimelines.map((t) => t.boneId).sort()).toEqual(["b1", "b2"]);
    expect(out.keyCount).toBeGreaterThan(4);
    expect(out.animation.rotationTimelines.some((t) => t.keys.some((k) => k.curve))).toBe(true);
    expect(
      await failure(server, "autospine_build_keypose_animation", {
        rig,
        spec: {
          ...spec,
          rules: [{ rule: "follow", control: "t2", source: "zz", lag: 4, gain: 1 }],
        },
      }),
    ).toMatch(/^KEYPOSE_/);
  });

  it("meshes a part with socket rings and measures its dome", async () => {
    const server = await ready();
    const built = (await ok(server, "autospine_feature_mesh", { part: facePart })) as {
      mesh: MeshSpec;
      rings: number[][];
      space: string;
    };
    expect(built.rings.length).toBe(2);
    expect(built.space).toBe("part-bounds");
    const dome = (await ok(server, "autospine_measure_dome", {
      part: facePart,
      toWorld: [1, 0, 0, 1, -60, -40],
    })) as { field: { center: number[]; radii: number[]; peak: number }; foldLimit: number[] };
    expect(dome.field.peak).toBe(0.7);
    expect(Math.abs(dome.field.center[0]!)).toBeLessThan(1);
    expect(dome.foldLimit[0]).toBeCloseTo(dome.field.radii[0]! / 1.4, 9);
    const bare = { ...facePart, alphaMask: undefined };
    expect(await failure(server, "autospine_feature_mesh", { part: bare })).toBe("MCP_PART_ALPHA");
    expect(
      await failure(server, "autospine_measure_dome", { part: facePart, toWorld: [1, 0, 0] }),
    ).toBe("MCP_TOOL_ARGUMENTS");
  });

  it("solves pinned dome weights and reports dome values", async () => {
    const server = await ready();
    const field = { center: [40, 0], radii: [50, 20], peak: 0.7, counter: 0.1 };
    const pins = [
      {
        polygon: [
          [20, -3],
          [30, -3],
          [30, 3],
        ],
        value: 0.4,
        margin: 5,
      },
    ];
    const out = (await ok(server, "autospine_dome_weights", {
      mesh: tail,
      rig,
      field,
      bones: { base: "root", control: "ctrl", counter: "back" },
      pins,
      points: [
        [40, 0],
        [26, 0],
      ],
    })) as { weights: WeightSpec; values: number[] };
    expect(out.weights.vertices).toHaveLength(tail.vertices.length);
    expect(out.values[0]).toBeCloseTo(0.7, 12);
    expect(out.values[1]).toBeCloseTo(0.4, 12);
    expect(
      await failure(server, "autospine_dome_weights", {
        mesh: tail,
        rig,
        field,
        bones: { base: "root", control: "root" },
      }),
    ).toBe("DOME_BONES");
  });

  it("weights chains, gradients and riding meshes, then measures their seam", async () => {
    const server = await ready();
    const chain = (await ok(server, "autospine_chain_weights", {
      mesh: tail,
      rig,
      boneIds: ["b1", "b2", "b3"],
      blendWidth: [8, 6],
    })) as { weights: WeightSpec };
    expect(chain.weights.vertices).toHaveLength(tail.vertices.length);
    const gradient = (await ok(server, "autospine_gradient_weights", {
      mesh: tail,
      rig,
      from: "b1",
      to: "b3",
    })) as { weights: WeightSpec };
    expect(gradient.weights.vertices.every((v) => v.influences.length <= 2)).toBe(true);
    const transfer = (await ok(server, "autospine_transfer_weights", {
      target: glow,
      rig,
      sources: [{ mesh: tail, weights: tailWeights }],
    })) as { weights: WeightSpec };
    expect(transfer.weights.meshId).toBe(glow.id);
    const pose = { rotations: { b2: 25, b3: 20 } };
    const overlap = (await ok(server, "autospine_measure_overlap", {
      rig,
      a: { mesh: tail, weights: tailWeights },
      b: { mesh: glow, weights: transfer.weights },
      pose,
    })) as {
      drift: { points: number; maxDrift: number };
      deformation: { inversionCount: number }[];
      artistQualityAccepted: boolean;
    };
    expect(overlap.drift.points).toBeGreaterThan(20);
    expect(overlap.drift.maxDrift).toBeLessThan(1e-6); // transferred weights ride the source exactly
    expect(overlap.deformation).toHaveLength(2);
    expect(overlap.artistQualityAccepted).toBe(false);
    expect(
      await failure(server, "autospine_gradient_weights", {
        mesh: tail,
        rig,
        from: "b1",
        to: "b1",
      }),
    ).toBe("GRADIENT_BONES");
    expect(
      await failure(server, "autospine_transfer_weights", {
        target: glow,
        rig,
        sources: [{ mesh: tail, weights: tailWeights }],
        maxInfluences: 5,
      }),
    ).toBe("MCP_TOOL_ARGUMENTS");
  });

  it("never writes to the workspace", async () => {
    const before = await readdir(process.cwd()),
      server = await ready();
    await ok(server, "autospine_feature_mesh", { part: facePart });
    await ok(server, "autospine_chain_weights", {
      mesh: tail,
      rig,
      boneIds: ["b1", "b2", "b3"],
      blendWidth: 8,
    });
    expect(await readdir(process.cwd())).toEqual(before);
  });
});
