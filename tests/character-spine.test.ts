import { describe, expect, it } from "vitest";
import {
  AtlasAttachmentLoader,
  TextureAtlas,
  FakeTexture,
  SkeletonJson,
  Skeleton,
  MeshAttachment,
  RegionAttachment,
  MixBlend,
  MixDirection,
  ClippingAttachment,
  SkeletonClipping,
} from "@esotericsoftware/spine-core";
import { compileCharacterSpine40, type CharacterSpineInput } from "@autospine/spine";
import { rigFromWorldFrames } from "@autospine/rig";
import { solveChainWeights, skinVertices } from "@autospine/weights";
import { generatePreset } from "@autospine/motion";
import { AutoSpineMcpServer } from "@autospine/mcp";
import { stripFixture } from "./engine-fixtures.js";

function fixture(): CharacterSpineInput {
  const { mesh } = stripFixture(16, 3);
  const rig = rigFromWorldFrames("character", "Character", [
    { id: "root", name: "root", length: 0, world: [1, 0, 0, 1, 0, 0] },
    { id: "upper", name: "upper", parentId: "root", length: 40, world: [1, 0, 0, 1, 0, 0] },
    { id: "lower", name: "lower", parentId: "upper", length: 40, world: [1, 0, 0, 1, 40, 0] },
    { id: "target", name: "target", parentId: "root", length: 0, world: [1, 0, 0, 1, 65, -20] },
    { id: "hand", name: "hand", parentId: "lower", length: 10, world: [1, 0, 0, 1, 80, 0] },
  ]);
  const weights = solveChainWeights(mesh, rig, ["upper", "lower"], 12);
  const asset = {
    schemaVersion: "0.1" as const,
    kind: "asset" as const,
    id: "part",
    name: "Part",
    source: { type: "png-parts" as const, path: "image.png" },
    width: 80,
    height: 6,
    parts: [
      {
        id: mesh.sourcePartId,
        name: "Part",
        sourcePath: "image.png",
        bounds: { x: 0, y: -3, width: 80, height: 6 },
        drawOrder: 0,
      },
    ],
  };
  return {
    rig,
    imagesPath: "./images/",
    slots: [
      {
        name: "arm",
        boneId: "root",
        attachment: "arm",
        attachments: [{ kind: "mesh", name: "arm", path: "image", asset, mesh, weights }],
      },
      {
        name: "palm",
        boneId: "hand",
        attachment: "palm",
        attachments: [
          {
            kind: "region",
            name: "palm",
            path: "image",
            boneId: "hand",
            width: 80,
            height: 6,
            world: [-1, 0, 0, 1, 80, 0],
          },
        ],
      },
    ],
    animations: [generatePreset(rig, { type: "sway", duration: 1.4, fps: 30, amplitude: 10 })],
  };
}
function runtime(input: CharacterSpineInput) {
  const atlas = new TextureAtlas(
    "page.png\nsize: 80,6\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nimage\n  rotate: false\n  xy: 0, 0\n  size: 80, 6\n  orig: 80, 6\n  offset: 0, 0\n  index: -1\n",
  );
  atlas.pages[0]!.setTexture(new FakeTexture({ width: 80, height: 6 } as HTMLImageElement));
  return new Skeleton(
    new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(
      compileCharacterSpine40(input),
    ),
  );
}
describe("explicit multi-part Spine adapter", () => {
  it("exports weighted world-space deform through mirrored bind frames and keeps rgba alongside attachments", () => {
    const input = fixture();
    input.rig.bones[0]!.scaleX = -1;
    input.rig.bones[2]!.rotation = 25;
    input.animations = [
      generatePreset(input.rig, { type: "sway", duration: 1, fps: 30, amplitude: 0 }),
    ];
    const part = input.slots[0]!.attachments[0]!;
    if (part.kind !== "mesh") throw Error("fixture");
    input.deformTimelines = [
      {
        animationName: "sway",
        slotName: "arm",
        attachmentName: "arm",
        keys: [
          { time: 0, offsets: part.mesh.vertices.map(() => [0, 0]) },
          { time: 1, offsets: part.mesh.vertices.map(() => [4, 6]) },
        ],
      },
    ];
    input.attachmentTimelines = [
      {
        animationName: "sway",
        slotName: "arm",
        keys: [
          { time: 0, name: "arm" },
          { time: 1, name: "arm" },
        ],
      },
    ];
    input.colorTimelines = [
      {
        animationName: "sway",
        slotName: "arm",
        keys: [
          { time: 0, color: "ffffffff" },
          { time: 1, color: "80402080" },
        ],
      },
    ];
    const sk = runtime(input),
      slot = sk.slots[0]!;
    const a = slot.getAttachment() as MeshAttachment;
    const before = new Array<number>(a.worldVerticesLength),
      after = new Array<number>(a.worldVerticesLength);
    sk.updateWorldTransform();
    a.computeWorldVertices(slot, 0, before.length, before, 0, 2);
    sk.data.animations[0]!.apply(sk, 0, 1, false, [], 1, MixBlend.replace, MixDirection.mixIn);
    sk.updateWorldTransform();
    a.computeWorldVertices(slot, 0, after.length, after, 0, 2);
    for (let i = 0; i < before.length; i += 2) {
      expect(after[i]! - before[i]!).toBeCloseTo(4, 5);
      expect(after[i + 1]! - before[i + 1]!).toBeCloseTo(-6, 5);
    }
    expect(slot.color.a).toBeCloseTo(128 / 255, 5);
    input.deformTimelines[0]!.keys[1]!.offsets.pop();
    expect(() => compileCharacterSpine40(input)).toThrow(/count/);
  });
  it("evaluates a convex clipping mask and rejects missing end slots and degenerate polygons", () => {
    const input = fixture();
    input.slots.unshift({
      name: "mask",
      boneId: "root",
      attachment: "mask",
      attachments: [
        {
          kind: "clipping",
          name: "mask",
          boneId: "root",
          endSlotName: "palm",
          worldVertices: [
            [20, -10],
            [60, -10],
            [60, 10],
            [20, 10],
          ],
        },
      ],
    });
    const sk = runtime(input);
    sk.updateWorldTransform();
    const clip = new SkeletonClipping(),
      mask = sk.slots[0]!.getAttachment() as ClippingAttachment;
    expect(mask.endSlot?.name).toBe("palm");
    clip.clipStart(sk.slots[0]!, mask);
    expect(clip.isClipping()).toBe(true);
    clip.clipEndWithSlot(sk.slots.at(-1)!);
    expect(clip.isClipping()).toBe(false);
    const a = input.slots[0]!.attachments[0]!;
    if (a.kind !== "clipping") throw Error("fixture");
    a.endSlotName = "missing";
    expect(() => compileCharacterSpine40(input)).toThrow(/end slot/);
    a.endSlotName = "palm";
    a.worldVertices = [
      [0, 0],
      [1, 0],
      [2, 0],
    ];
    expect(() => compileCharacterSpine40(input)).toThrow(/convex/);
    a.worldVertices = Array.from({ length: 5 }, (_, i) => {
      const t = (i * 4 * Math.PI) / 5;
      return [Math.cos(t) * 10, Math.sin(t) * 10];
    });
    expect(() => compileCharacterSpine40(input)).toThrow(/crossing/);
    a.worldVertices = [
      [0, 0],
      [5, 0],
      [5, 5],
      [0, 5],
    ];
    const maskSlot = input.slots.shift()!;
    input.slots.push(maskSlot);
    expect(() => compileCharacterSpine40(input)).toThrow(/draw order/);
  });
  it("keeps a stage mask fixed while a child character enters and scales", () => {
    const input = fixture();
    input.rig.bones.unshift({ id: "stage", name: "stage", length: 0, x: 0, y: 0, rotation: 0 });
    input.rig.bones.find((b) => b.id === "root")!.parentId = "stage";
    input.slots.unshift({
      name: "mask",
      boneId: "stage",
      attachment: "mask",
      attachments: [
        {
          kind: "clipping",
          name: "mask",
          boneId: "stage",
          endSlotName: "palm",
          worldVertices: [
            [0, -10],
            [100, -10],
            [100, 10],
            [0, 10],
          ],
        },
      ],
    });
    input.animations = [
      generatePreset(input.rig, { type: "sway", duration: 1, fps: 30, amplitude: 0 }),
    ];
    input.animations[0]!.translationTimelines = [
      {
        boneId: "root",
        keys: [
          { time: 0, x: 0, y: 200 },
          { time: 1, x: 0, y: 0 },
        ],
      },
    ];
    input.animations[0]!.scaleTimelines = [
      {
        boneId: "root",
        keys: [
          { time: 0, x: 0.65, y: 0.65 },
          { time: 1, x: 0.65, y: 0.65 },
        ],
      },
    ];
    const sk = runtime(input),
      mask = sk.slots[0]!.getAttachment() as ClippingAttachment,
      w = new Array<number>(8);
    for (const time of [0, 0.5, 1]) {
      sk.setToSetupPose();
      sk.data.animations[0]!.apply(sk, 0, time, false, [], 1, MixBlend.replace, MixDirection.mixIn);
      sk.updateWorldTransform();
      mask.computeWorldVertices(sk.slots[0]!, 0, 8, w, 0, 2);
      [0, 10, 100, 10, 100, -10, 0, -10].forEach((value, i) => expect(w[i]).toBeCloseTo(value, 5));
      expect(sk.findBone("root")!.worldY).toBeCloseTo(-200 * (1 - time), 5);
    }
  });
  it("supports bounded reverse local follow with explicit offsets", () => {
    const input = fixture();
    input.transform = [
      {
        name: "reverse",
        boneIds: ["hand"],
        targetId: "target",
        order: 0,
        local: true,
        relative: true,
        mixRotate: 1,
        mixX: -0.5,
        mixY: 0,
        mixScaleX: 0,
        mixScaleY: 0,
        mixShearY: 0,
        rotation: 10,
      },
    ];
    const sk = runtime(input);
    sk.updateWorldTransform();
    expect(sk.findBone("hand")!.worldX).toBeCloseTo(47.5, 5);
    expect(
      (Math.atan2(sk.findBone("hand")!.c, sk.findBone("hand")!.a) * 180) / Math.PI,
    ).toBeCloseTo(-10, 5);
  });
  it("keeps part-scoped follow-through unchanged when unrelated controls are inserted", () => {
    const input = fixture(),
      options = {
        type: "follow-through" as const,
        duration: 2,
        fps: 30,
        amplitude: 6,
        boneIds: ["upper", "lower"],
      };
    const before = generatePreset(input.rig, options);
    input.rig.bones.splice(1, 0, {
      id: "unrelated",
      name: "unrelated",
      parentId: "root",
      x: 0,
      y: 0,
      length: 0,
      rotation: 0,
    });
    expect(generatePreset(input.rig, options)).toEqual(before);
    expect(Math.max(...before.rotationTimelines![0]!.keys.map((k) => k.degrees))).toBeGreaterThan(
      5,
    );
    expect(() => generatePreset(input.rig, { ...options, boneIds: ["missing"] })).toThrow(
      /controls/,
    );
  });
  it("compresses a one-bone arm to its target while preserving hand size and attachment visibility", () => {
    const input = fixture();
    const upper = input.rig.bones.find((b) => b.id === "upper")!,
      lower = input.rig.bones.find((b) => b.id === "lower")!,
      hand = input.rig.bones.find((b) => b.id === "hand")!;
    upper.length = 80;
    lower.x = 80;
    lower.length = 0;
    hand.x = 0;
    input.ik = [
      {
        name: "reach",
        boneIds: ["upper"],
        targetId: "target",
        order: 0,
        mix: 1,
        bendPositive: true,
        compress: true,
        stretch: true,
      },
    ];
    input.transform = [
      {
        name: "hand-size",
        boneIds: ["hand"],
        targetId: "target",
        order: 1,
        mixRotate: 1,
        mixX: 0,
        mixY: 0,
        mixScaleX: 1,
        mixScaleY: 1,
        mixShearY: 0,
      },
    ];
    input.attachmentTimelines = [
      {
        animationName: input.animations[0]!.name,
        slotName: "palm",
        keys: [
          { time: 0, name: null },
          { time: 0.5, name: "palm" },
          { time: 1.4, name: null },
        ],
      },
    ];
    const sk = runtime(input);
    sk.setToSetupPose();
    sk.updateWorldTransform();
    const h = sk.findBone("hand")!,
      target = sk.findBone("target")!;
    expect(Math.hypot(h.worldX - target.worldX, h.worldY - target.worldY)).toBeLessThan(1e-4);
    expect(Math.hypot(h.a, h.c)).toBeCloseTo(1, 6);
    sk.data.animations[0]!.apply(sk, 0, 0, false, [], 1, MixBlend.replace, MixDirection.mixIn);
    expect(sk.slots[1]!.getAttachment()).toBeNull();
    sk.data.animations[0]!.apply(sk, 0, 0.5, false, [], 1, MixBlend.replace, MixDirection.mixIn);
    expect(sk.slots[1]!.getAttachment()?.name).toBe("palm");
    input.attachmentTimelines[0]!.keys[1]!.name = "missing";
    expect(() => compileCharacterSpine40(input)).toThrow(/references/);
  });
  it("preserves mirrored region setup and engine skinning through the official Runtime", () => {
    const input = fixture(),
      sk = runtime(input);
    sk.setToSetupPose();
    sk.updateWorldTransform();
    const region = sk.slots[1]!.getAttachment() as RegionAttachment,
      quad = new Array<number>(8);
    region.computeWorldVertices(sk.slots[1]!.bone, quad, 0, 2);
    expect(Math.min(quad[0]!, quad[2]!, quad[4]!, quad[6]!)).toBeCloseTo(40, 5);
    expect(Math.max(quad[0]!, quad[2]!, quad[4]!, quad[6]!)).toBeCloseTo(120, 5);
    const part = input.slots[0]!.attachments[0]!;
    if (part.kind !== "mesh") throw Error("fixture");
    for (const time of [0, 0.37, 1.4]) {
      sk.setToSetupPose();
      sk.data.animations[0]!.apply(sk, 0, time, false, [], 1, MixBlend.replace, MixDirection.mixIn);
      sk.updateWorldTransform();
      const a = sk.slots[0]!.getAttachment() as MeshAttachment,
        w = new Array<number>(a.worldVerticesLength);
      a.computeWorldVertices(sk.slots[0]!, 0, w.length, w, 0, 2);
      const angle = sk.findBone("root")!.rotation;
      // The test preset keys all bones with equal image-space rotation.
      const expected = skinVertices(
        part.mesh,
        input.rig,
        part.weights,
        Object.fromEntries(input.rig.bones.map((b) => [b.id, -angle])),
      );
      const hull = new Set(part.mesh.hull),
        order = [
          ...part.mesh.hull,
          ...part.mesh.vertices.map((_, i) => i).filter((i) => !hull.has(i)),
        ];
      order.forEach((v, i) => {
        expect(w[i * 2]).toBeCloseTo(expected[v]![0], 4);
        expect(w[i * 2 + 1]).toBeCloseTo(-expected[v]![1], 4);
      });
    }
  });
  it("runs native IK before hand orientation and rejects a descendant target or wrong order", () => {
    const input = fixture();
    input.ik = [
      {
        name: "arm",
        boneIds: ["upper", "lower"],
        targetId: "target",
        order: 0,
        mix: 1,
        bendPositive: true,
      },
    ];
    input.transform = [
      {
        name: "palm",
        boneIds: ["hand"],
        targetId: "target",
        order: 1,
        mixRotate: 1,
        mixX: 0,
        mixY: 0,
        mixScaleX: 0,
        mixScaleY: 0,
        mixShearY: 0,
      },
    ];
    const sk = runtime(input);
    sk.setToSetupPose();
    sk.updateWorldTransform();
    const lower = sk.findBone("lower")!,
      target = sk.findBone("target")!,
      hand = sk.findBone("hand")!;
    expect(
      Math.hypot(
        lower.worldX + lower.a * 40 - target.worldX,
        lower.worldY + lower.c * 40 - target.worldY,
      ),
    ).toBeLessThan(1e-4);
    expect(Math.atan2(hand.c, hand.a)).toBeCloseTo(0, 6);
    const bad = structuredClone(input);
    bad.ik![0]!.targetId = "hand";
    expect(() => compileCharacterSpine40(bad)).toThrow(/descend/);
    input.transform[0]!.order = 0;
    expect(() => compileCharacterSpine40(input)).toThrow(/order/);
  });
  it("fails missing selections and compiles character IR through initialized MCP without file writes", async () => {
    const input = fixture(),
      bad = structuredClone(input);
    bad.slots[0]!.attachment = "missing";
    expect(() => compileCharacterSpine40(bad)).toThrow(/selection/);
    const server = new AutoSpineMcpServer(process.cwd());
    await server.receive({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
    });
    await server.receive({ jsonrpc: "2.0", method: "notifications/initialized" });
    const reply = (await server.receive({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "autospine_compile_character", arguments: { input } },
    })) as {
      result: {
        isError?: boolean;
        structuredContent: { document: unknown; artistQualityAccepted: boolean };
      };
    };
    expect(reply.result.isError).not.toBe(true);
    expect(reply.result.structuredContent.document).toEqual(compileCharacterSpine40(input));
    expect(reply.result.structuredContent.artistQualityAccepted).toBe(false);
  });
  it("keeps decimal durations exact and chain weights local to adjacent joint bands", () => {
    const input = fixture(),
      part = input.slots[0]!.attachments[0]!;
    if (part.kind !== "mesh") throw Error("fixture");
    expect(input.animations[0]!.rotationTimelines![0]!.keys.at(-1)!.time).toBe(1.4);
    expect(part.weights.vertices[0]!.influences).toEqual([{ boneId: "upper", weight: 1 }]);
    expect(part.weights.vertices.find((v) => v.influences.length === 2)).toBeDefined();
    expect(() => solveChainWeights(part.mesh, input.rig, ["lower", "upper"], 12)).toThrow(/chain/);
    expect(() => solveChainWeights(part.mesh, input.rig, ["upper", "lower"], 30)).toThrow(/half/);
  });
});
