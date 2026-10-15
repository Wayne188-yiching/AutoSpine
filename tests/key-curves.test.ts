import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
  AtlasAttachmentLoader,
  FakeTexture,
  MeshAttachment,
  MixBlend,
  MixDirection,
  Skeleton,
  SkeletonJson,
  TextureAtlas,
} from "@esotericsoftware/spine-core";
import { AnimationSpecSchema, type AnimationSpec, type KeyCurve } from "@autospine/schemas";
import {
  keyFraction,
  rotationsAt,
  sampleAnimation,
  validateAnimation,
  validateLoop,
} from "@autospine/motion";
import {
  compileCharacterSpine40,
  compileSpine40,
  validateMinimalSpineInput,
  type CharacterSpineInput,
  type MinimalSpineInput,
} from "@autospine/spine";
import { rigFromWorldFrames } from "@autospine/rig";
import { solveChainWeights } from "@autospine/weights";
import { stripFixture } from "./engine-fixtures.js";

const ease: KeyCurve = { type: "bezier", x1: 0.25, y1: 0, x2: 0.75, y2: 1 };
const snap: KeyCurve = { type: "bezier", x1: 0.12, y1: 0.6, x2: 0.45, y2: 1 };
const overshoot: KeyCurve = { type: "bezier", x1: 0.3, y1: 1.6, x2: 0.6, y2: 1.2 };

function rig() {
  return rigFromWorldFrames("curves", "Curves", [
    { id: "root", name: "root", length: 0, world: [1, 0, 0, 1, 0, 0] },
    { id: "upper", name: "upper", parentId: "root", length: 40, world: [1, 0, 0, 1, 0, 0] },
    { id: "lower", name: "lower", parentId: "upper", length: 40, world: [1, 0, 0, 1, 40, 0] },
    { id: "target", name: "target", parentId: "root", length: 0, world: [1, 0, 0, 1, 65, -20] },
    { id: "hand", name: "hand", parentId: "lower", length: 10, world: [1, 0, 0, 1, 80, 0] },
  ]);
}
/** Sparse pose-to-pose keys: ease, stepped hold, snap, overshoot and an omitted (linear) curve. */
function sparse(): AnimationSpec {
  return {
    schemaVersion: "0.1",
    kind: "animation",
    id: "curves",
    name: "curves",
    rigId: "curves",
    duration: 1.2,
    loop: true,
    motions: [],
    rotationTimelines: [
      {
        boneId: "upper",
        keys: [
          { time: 0, degrees: 0, curve: ease },
          { time: 0.4, degrees: 30, curve: { type: "stepped" } },
          { time: 0.8, degrees: -12, curve: snap },
          { time: 1.2, degrees: 0 },
        ],
      },
    ],
    translationTimelines: [
      {
        boneId: "target",
        keys: [
          { time: 0, x: 0, y: 0, curve: overshoot },
          { time: 0.6, x: 8, y: -5, curve: ease },
          { time: 1.2, x: 0, y: 0 },
        ],
      },
    ],
    scaleTimelines: [
      {
        boneId: "hand",
        keys: [
          { time: 0, x: 1, y: 1, curve: snap },
          { time: 0.5, x: 1.2, y: 0.9 },
          { time: 1.2, x: 1, y: 1 },
        ],
      },
    ],
  };
}
function character(): CharacterSpineInput {
  const r = rig(),
    { mesh } = stripFixture(16, 3);
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
  const weights = solveChainWeights(mesh, r, ["upper", "lower"], 12);
  return {
    rig: r,
    imagesPath: "./images/",
    slots: [
      {
        name: "arm",
        boneId: "root",
        attachment: "arm",
        attachments: [{ kind: "mesh", name: "arm", path: "image", asset, mesh, weights }],
      },
    ],
    animations: [sparse()],
    colorTimelines: [
      {
        animationName: "curves",
        slotName: "arm",
        keys: [
          { time: 0, color: "ffffffff", curve: { type: "stepped" } },
          { time: 0.6, color: "ffffff00", curve: ease },
          { time: 1.2, color: "ffffffff" },
        ],
      },
    ],
    deformTimelines: [
      {
        animationName: "curves",
        slotName: "arm",
        attachmentName: "arm",
        keys: [
          { time: 0, offsets: mesh.vertices.map(() => [0, 0]), curve: ease },
          { time: 0.6, offsets: mesh.vertices.map(() => [4, 6]), curve: { type: "stepped" } },
          { time: 1.2, offsets: mesh.vertices.map(() => [0, 0]) },
        ],
      },
    ],
  };
}
function load(document: unknown) {
  const atlas = new TextureAtlas(
    "page.png\nsize: 80,6\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nimage\n  rotate: false\n  xy: 0, 0\n  size: 80, 6\n  orig: 80, 6\n  offset: 0, 0\n  index: -1\n",
  );
  atlas.pages[0]!.setTexture(new FakeTexture({ width: 80, height: 6 } as HTMLImageElement));
  return new Skeleton(
    new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(document),
  );
}
function code(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return (error as { validation?: { issues: { code: string }[] } }).validation?.issues[0]?.code;
  }
  return "no error";
}
// Sample between keys plus just after each key: spine-core stores key times as float32, so a query
// exactly at 0.8 still precedes the stored 0.800000011920929 and would read the previous segment.
const times = [
  ...Array.from({ length: 97 }, (_, k) => (1.2 * (k + 0.37)) / 97),
  ...[0, 0.4, 0.5, 0.6, 0.8].map((t) => t + 1e-5),
  1.2,
];

describe("keyframe curves in AnimationSpec", () => {
  it("accepts normalized linear, stepped and bezier curves and rejects anything else", () => {
    expect(Value.Check(AnimationSpecSchema, sparse())).toBe(true);
    const variants: unknown[] = [
      { type: "bezier", x1: 1.2, y1: 0, x2: 0.5, y2: 1 },
      { type: "bezier", x1: 0.2, y1: 11, x2: 0.5, y2: 1 },
      { type: "bezier", x1: 0.2, y1: 0, x2: 0.5 },
      { type: "bezier", x1: 0.2, y1: 0, x2: 0.5, y2: 1, cx1: 0 },
      { type: "ease" },
      "stepped",
    ];
    for (const curve of variants) {
      const a = sparse() as unknown as { rotationTimelines: { keys: { curve: unknown }[] }[] };
      a.rotationTimelines[0]!.keys[0]!.curve = curve;
      expect(Value.Check(AnimationSpecSchema, a)).toBe(false);
    }
  });

  it("samples the eased fraction of the segment's first key in sampleAnimation and rotationsAt", () => {
    const a = sparse(),
      r = rig();
    const at = (t: number) => sampleAnimation(a, r, t);
    expect(at(0.2).rotations.upper).toBeCloseTo(15, 9); // symmetric ease midpoint
    expect(at(0.1).rotations.upper!).toBeLessThan(7.5); // slow start
    expect(at(0.4).rotations.upper).toBe(30);
    expect(at(0.79).rotations.upper).toBe(30); // stepped hold
    expect(at(0.8).rotations.upper).toBe(-12);
    expect(at(0.85).scales.hand![0]).toBeCloseTo(1.1, 12); // omitted curve stays linear
    expect(at(0.85).scales.hand![1]).toBeCloseTo(0.95, 12);
    const xs = times.filter((t) => t < 0.6).map((t) => at(t).translations.target![0]);
    expect(Math.max(...xs)).toBeGreaterThan(8.5); // overshoots the key value before settling
    for (const t of times) expect(rotationsAt(a, t).upper).toBeCloseTo(at(t).rotations.upper!, 12);
    expect(keyFraction(undefined, 0.3)).toBe(0.3);
    expect(keyFraction({ type: "stepped" }, 0.999)).toBe(0);
    expect(validateLoop(a, r).status).toBe("passed");
  });

  it("rejects a curve on a final key instead of silently dropping it", () => {
    const a = sparse();
    a.rotationTimelines![0]!.keys.at(-1)!.curve = ease;
    expect(code(() => validateAnimation(a, rig()))).toBe("ANIMATION_CURVE");
    const input = character();
    input.animations = [a];
    expect(code(() => compileCharacterSpine40(input))).toBe("SPINE_TIMELINE");
    const color = character();
    color.colorTimelines![0]!.keys.at(-1)!.curve = { type: "stepped" };
    expect(code(() => compileCharacterSpine40(color))).toBe("SPINE_CHARACTER");
    // An invalid input names the first offending path.
    const short = character();
    short.colorTimelines![0]!.keys = [short.colorTimelines![0]!.keys[0]!];
    expect(() => compileCharacterSpine40(short)).toThrow(/required: \/colorTimelines\/0\/keys/);
  });

  it("takes one timeline per animation and slot beyond 512 (one project per character)", () => {
    // 12 slots x 50 animations: 600 colour timelines, as a merged character holds.
    const many = character();
    const slot = many.slots[0]!,
      line = many.colorTimelines![0]!,
      anim = many.animations[0]!;
    many.slots = Array.from({ length: 12 }, (_, k) => ({ ...slot, name: `arm${k}` }));
    many.animations = Array.from({ length: 50 }, (_, a) => ({
      ...anim,
      id: `a${a}`,
      name: `a${a}`,
    }));
    many.colorTimelines = many.animations.flatMap((a) =>
      many.slots.map((s) => ({ ...line, animationName: a.name, slotName: s.name })),
    );
    many.deformTimelines = [];
    expect(many.colorTimelines).toHaveLength(600);
    expect(() => compileCharacterSpine40(many)).not.toThrow();
  });

  it("exports Spine 4.0 absolute handles that the official Runtime evaluates like the IR", () => {
    const input = character(),
      doc = compileCharacterSpine40(input) as unknown as {
        animations: Record<string, Record<string, Record<string, unknown>>>;
      };
    const bones = doc.animations.curves!.bones as Record<
      string,
      Record<string, { curve?: unknown }[]>
    >;
    // Rotation is negated at the adapter boundary, so are its handle values.
    expect(JSON.stringify(bones.upper!.rotate![0]!.curve)).toBe("[0.1,0,0.30000000000000004,-30]");
    expect(bones.upper!.rotate![1]!.curve).toBe("stepped");
    expect(bones.upper!.rotate![3]!.curve).toBeUndefined();
    expect((bones.target!.translate![0]!.curve as number[]).length).toBe(8);
    expect(bones.hand!.scale![1]!.curve).toBeUndefined();

    const sk = load(doc),
      animation = sk.data.findAnimation("curves")!;
    const bone = (name: string) => sk.findBone(name)!;
    const ir = sparse(),
      r = rig();
    // spine-core flattens each Bezier into 10 line segments, so compare relative to the change.
    let worst = 0;
    const compare = (runtime: number, expected: number, span: number) =>
      (worst = Math.max(worst, Math.abs(runtime - expected) / span));
    for (const t of times) {
      sk.setToSetupPose();
      animation.apply(sk, 0, t, false, [], 1, MixBlend.replace, MixDirection.mixIn);
      const p = sampleAnimation(ir, r, t);
      compare(bone("upper").rotation - bone("upper").data.rotation, -p.rotations.upper!, 42);
      compare(bone("target").x - bone("target").data.x, p.translations.target![0], 8);
      compare(bone("target").y - bone("target").data.y, -p.translations.target![1], 5);
      compare(bone("hand").scaleX / bone("hand").data.scaleX, p.scales.hand![0], 0.2);
      compare(bone("hand").scaleY / bone("hand").data.scaleY, p.scales.hand![1], 0.1);
    }
    // Measured spine-core 4.0 flattening error for these handles alone: ease 0.6%, snap 0.8%,
    // overshoot 1.4% of the segment change; the compiled export adds nothing measurable on top.
    expect(worst).toBeLessThan(0.02);

    const slot = sk.findSlot("arm")!,
      mesh = slot.getAttachment() as MeshAttachment,
      before = new Array<number>(mesh.worldVerticesLength),
      after = new Array<number>(mesh.worldVerticesLength);
    const pose = (t: number) => {
      sk.setToSetupPose();
      sk.updateWorldTransform();
      mesh.computeWorldVertices(slot, 0, before.length, before, 0, 2);
      animation.apply(sk, 0, t, false, [], 1, MixBlend.replace, MixDirection.mixIn);
      // Deform is measured against the animated bones, so keep bones at setup for this check.
      for (const b of sk.bones) b.setToSetupPose();
      sk.updateWorldTransform();
      mesh.computeWorldVertices(slot, 0, after.length, after, 0, 2);
      return [after[0]! - before[0]!, after[1]! - before[1]!];
    };
    for (const t of [0.15, 0.3, 0.45]) {
      const f = keyFraction(ease, t / 0.6),
        [dx, dy] = pose(t);
      expect(Math.abs(dx! - 4 * f)).toBeLessThan(0.04);
      expect(Math.abs(dy! + 6 * f)).toBeLessThan(0.06);
    }
    // Stepped deform hold; the runtime keeps deform vertices in float32.
    expect(pose(0.9)).toEqual([4, -6].map((v) => expect.closeTo(v, 5)));
    pose(0.59);
    expect(slot.color.a).toBe(1); // stepped alpha hold
    pose(0.6 + 1e-5);
    expect(slot.color.a).toBeLessThan(0.01);
    pose(0.75);
    expect(slot.color.a).toBeLessThan(0.25); // ease starts slowly from 0
    pose(0.9);
    expect(slot.color.a).toBeCloseTo(0.5, 2); // symmetric ease midpoint of 0 -> 1
  });

  it("keeps the narrow Gate 1 adapter linear-only with an explicit issue", () => {
    const input = JSON.parse(
      readFileSync(resolve(process.cwd(), "fixtures/spine/minimal/input.json"), "utf8"),
    ) as MinimalSpineInput;
    const linear = structuredClone(input);
    linear.animation.rotationTimelines![0]!.keys[0]!.curve = { type: "linear" };
    expect(JSON.stringify(compileSpine40(linear))).toBe(JSON.stringify(compileSpine40(input)));
    const curved = structuredClone(input);
    curved.animation.rotationTimelines![0]!.keys[0]!.curve = ease;
    const report = validateMinimalSpineInput(curved);
    expect(report.status).toBe("error");
    expect(report.issues.map((i) => i.code)).toContain("TIMELINE_CURVE");
  });
});
