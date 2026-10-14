import { describe, expect, it } from "vitest";
import {
  buildCharacter,
  lintCharacterPlan,
  type CharacterLayout,
  type CharacterPart,
} from "@autospine/character";
import { readImagesOnlyLayout } from "@autospine/spine";
import { drawList, loadSkeleton, pose } from "@autospine/reference";
import { fixtureImagesOnly, fixtureLayout, fixturePlan, fixtureRgba } from "./character-fixture.js";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const layoutOf = (doc: unknown): CharacterLayout => {
  const read = readImagesOnlyLayout(doc);
  const parts = new Map<string, CharacterPart>();
  for (const a of read.attachments) {
    const { width, height, rgba } = fixtureRgba(a.path);
    const alpha = new Uint8Array(width * height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3]!;
    parts.set(a.key, { ...a, alpha });
  }
  return { slots: read.slots, parts, skeleton: read.skeleton };
};

describe("branching props (ADR-023)", () => {
  it("grows a chain from the strand end nearest a joint", () => {
    const plan = clone(fixturePlan());
    plan.joints.hairTip = { rule: "end", part: "Hair", dir: [0, 1], band: 6 };
    const chain = plan.bones.find((b) => "chain" in b && b.chain.part === "Hair") as {
      chain: { near?: string };
    };
    const y = (built: ReturnType<typeof buildCharacter>, id: string) =>
      built.rigging.rigged.world.get(id)!.o[1];
    const top = buildCharacter(plan, fixtureLayout());
    chain.chain.near = "hairTip";
    expect(lintCharacterPlan(plan).errors).toEqual([]);
    const bottom = buildCharacter(plan, fixtureLayout());
    // IR is y-down: from the top the chain descends, from the tip it climbs.
    expect(y(top, "hair_1")).toBeLessThan(y(top, "hair_3"));
    expect(y(bottom, "hair_1")).toBeGreaterThan(y(bottom, "hair_3"));
    chain.chain.near = "nowhere";
    expect(lintCharacterPlan(plan).errors.join("\n")).toMatch(/nowhere/);
  });

  it("weights a mesh to the nearest of listed bones only", () => {
    const plan = clone(fixturePlan());
    const arm = plan.meshes!.find((m) => m.part === "Arm_R")!;
    arm.weights = {
      type: "nearest",
      bones: ["arm_r", "forearm_r"],
      maxInfluences: 2,
      smoothing: 1,
    };
    const built = buildCharacter(plan, fixtureLayout());
    const w = built.rigging.meshes.get("Arm_R")!.weights.vertices;
    const ids = new Set(w.flatMap((v) => v.influences.map((i) => i.boneId)));
    expect([...ids].sort()).toEqual(["arm_r", "forearm_r"]);
    const mesh = built.rigging.meshes.get("Arm_R")!.mesh.vertices;
    const ys = mesh.map((p) => p[1]),
      top = ys.indexOf(Math.min(...ys)),
      bottom = ys.indexOf(Math.max(...ys));
    const of = (i: number, id: string) =>
      w[i]!.influences.find((x) => x.boneId === id)?.weight ?? 0;
    expect(of(top, "arm_r")).toBeGreaterThan(0.5);
    expect(of(bottom, "forearm_r")).toBeGreaterThan(0.5);
    arm.weights = { type: "nearest", bones: ["arm_r", "ghost"] };
    expect(lintCharacterPlan(plan).errors.join("\n")).toMatch(/ghost/);
  });

  it("meshes a mirrored placement with the winding the runtime expects", () => {
    // GoldTree (2026-10-14): boughs and leaves reused flipped images; 43 meshes were invalid.
    const doc = fixtureImagesOnly() as ReturnType<typeof fixtureImagesOnly>;
    const atts = doc.skins[0]!.attachments as Record<string, Record<string, { scaleX?: number }>>;
    atts.Arm_R!.Arm_R!.scaleX = -1;
    const built = buildCharacter(fixturePlan(), layoutOf(doc));
    const sk = loadSkeleton(built.document);
    pose(sk, null, 0);
    const arm = drawList(sk).find((d) => d.slot === "Arm_R")!;
    // Every triangle keeps a positive signed area on screen (y up).
    for (let t = 0; t < arm.tris.length; t += 3) {
      const [a, b, c] = [arm.tris[t]!, arm.tris[t + 1]!, arm.tris[t + 2]!].map((i) => [
        arm.verts[2 * i]!,
        arm.verts[2 * i + 1]!,
      ]);
      const area = (b![0]! - a![0]!) * (c![1]! - a![1]!) - (b![1]! - a![1]!) * (c![0]! - a![0]!);
      expect(Math.abs(area)).toBeGreaterThan(0);
    }
    // The mirrored image still covers its placed rectangle.
    const xs = arm.verts.filter((_, i) => i % 2 === 0);
    expect(Math.min(...xs)).toBeGreaterThan(20);
    expect(Math.max(...xs)).toBeLessThan(56);
  });
});
