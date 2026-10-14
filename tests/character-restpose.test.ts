import { describe, expect, it } from "vitest";
import {
  artistBudget,
  assetFor,
  buildCharacter,
  lintCharacterPlan,
  type CharacterPart,
} from "@autospine/character";
import { generateFeatureMesh } from "@autospine/mesh";
import {
  checkAcceptance,
  compareToReference,
  drawList,
  drivingBones,
  fitRestPose,
  loadSkeleton,
  pose,
  premultiply,
  prepareReference,
  render,
  restPoseDelta,
  sampleTracks,
} from "@autospine/reference";
import {
  FIXTURE_IMAGES,
  fixtureImagesOnly,
  fixtureLayout,
  fixturePlan,
} from "./character-fixture.js";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
type Doc = {
  bones: { name: string; rotation?: number }[];
  skins: { attachments: Record<string, Record<string, Record<string, unknown>>> }[];
};

/** A part image of `w` x `h` whose alpha is `inside`. */
const part = (w: number, h: number, inside: (x: number, y: number) => boolean): CharacterPart => {
  const alpha = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x, y)) alpha[y * w + x] = 255;
  return {
    key: "P",
    slot: "P",
    attachment: "P",
    path: "P",
    setup: true,
    order: 0,
    width: w,
    height: h,
    alpha,
    affine: [1, 0, 0, 1, 0, 0],
    sheared: false,
  };
};
/** Inside the polygon or on its boundary. */
const covered = (p: [number, number], poly: [number, number][]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!,
      [xj, yj] = poly[j]!;
    const dx = xj - xi,
      dy = yj - yi,
      t = Math.max(0, Math.min(1, ((p[0] - xi) * dx + (p[1] - yi) * dy) / (dx * dx + dy * dy)));
    if (Math.hypot(xi + t * dx - p[0], yi + t * dy - p[1]) < 1e-6) return true;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

describe("rest pose and artist wiring (ADR-024)", () => {
  it("budgets vertices like artist character meshes", () => {
    expect(artistBudget(75, 75)).toEqual({ hull: 9, interior: 0 });
    expect(artistBudget(340, 340)).toEqual({ hull: 18, interior: 4 });
    expect(artistBudget(4000, 4000).hull).toBe(40);
  });

  it("wraps separate blobs in one budget hull that covers every opaque pixel", () => {
    // Two eyes on one image (HorseYearFish W_Eye_W2): the default mesher keeps one component.
    const eyes = part(
      160,
      60,
      (x, y) => (x - 35) ** 2 + (y - 30) ** 2 < 400 || (x - 125) ** 2 + (y - 30) ** 2 < 400,
    );
    const asset = assetFor(eyes, "eyes");
    expect(() => generateFeatureMesh(asset.parts[0]!, eyes.alpha)).toThrow();
    const r = generateFeatureMesh(asset.parts[0]!, eyes.alpha, {
      hullVertices: 12,
      interiorVertices: 2,
    });
    expect(r.mesh.hull.length).toBe(12);
    const hull = r.mesh.hull.map((i) => r.mesh.vertices[i]!);
    for (let y = 0; y < 60; y++)
      for (let x = 0; x < 160; x++)
        if (eyes.alpha[y * 160 + x]) expect(covered([x + 0.5, y + 0.5], hull)).toBe(true);
    expect(r.mesh.vertices.length - 12).toBeGreaterThanOrEqual(1);
    expect(r.mesh.vertices.length - 12).toBeLessThanOrEqual(4);
  });

  it("meshes every shown region at artist density, rigid to its bone", () => {
    const plan = clone(fixturePlan());
    plan.meshing = { all: true };
    const built = buildCharacter(plan, fixtureLayout());
    const eyes = built.rigging.meshes.get("Eyes")!;
    const { hull, interior } = artistBudget(
      FIXTURE_IMAGES.Eyes!.width,
      FIXTURE_IMAGES.Eyes!.height,
    );
    expect(eyes.mesh.hull.length).toBe(hull);
    expect(eyes.mesh.vertices.length).toBeLessThanOrEqual(hull + interior + 1);
    expect(
      new Set(eyes.weights.vertices.flatMap((v) => v.influences.map((i) => i.boneId))),
    ).toEqual(new Set(["eyes"]));
    const att = (built.document as unknown as Doc).skins[0]!.attachments.Eyes!.Eyes!;
    expect(att.type).toBe("mesh");
    // An animation that shows other parts leaves the unshown regions alone.
    plan.motion.animations[0]!.show = ["Body"];
    expect(buildCharacter(plan, fixtureLayout()).rigging.meshes.has("Eyes")).toBe(false);
  });

  it("adds a rest pose to every key and checks its bones", () => {
    const plan = clone(fixturePlan());
    const before = buildCharacter(plan, fixtureLayout());
    plan.motion.animations[0]!.pose = { head: { rotate: 10 }, arm_r: { x: 4, y: -3 } };
    expect(lintCharacterPlan(plan).errors).toEqual([]);
    const after = buildCharacter(plan, fixtureLayout());
    const head = (b: typeof before) =>
      b.animations[0]!.rotationTimelines!.find((t) => t.boneId === "head")!.keys.map(
        (k) => k.degrees,
      );
    expect(head(after)).toEqual(head(before).map((d) => +(d + 10).toFixed(4)));
    // A bone without a translate timeline gets a constant one.
    const arm = after.animations[0]!.translationTimelines!.find((t) => t.boneId === "arm_r")!;
    expect(arm.keys.map((k) => [k.x, k.y])).toEqual([
      [4, -3],
      [4, -3],
    ]);
    // On the runtime the head turns 10 degrees clockwise (y up: -10) on frame 0.
    const angle = (doc: unknown) => {
      const sk = loadSkeleton(doc);
      pose(sk, "IDLE", 0);
      return sk.skeleton.findBone("head")!.getWorldRotationX();
    };
    expect(angle(after.document) - angle(before.document)).toBeCloseTo(-10, 3);
    // Seams are measured against frame 0: the turned head's seam is unchanged, and the moved arm
    // may bring other points into the visible seam band but stays well inside the limit.
    expect(after.seams[0]!.maxDrift).toBeCloseTo(before.seams[0]!.maxDrift, 1);
    for (const s of after.seams) expect(s.maxDrift).toBeLessThan(11);
    plan.motion.animations[0]!.pose = { ghost: { rotate: 1 } };
    expect(lintCharacterPlan(plan).errors.join("\n")).toMatch(/ghost/);
  });

  it("fits a rest pose back from a rendered reference", () => {
    const hash = (i: number, j: number) => {
      let n = (i * 374761393 + j * 668265263) | 0;
      n = Math.imul(n ^ (n >>> 13), 1274126177);
      return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
    };
    const noise = (x: number, y: number) => {
      const i = Math.floor(x / 4),
        j = Math.floor(y / 4),
        fx = x / 4 - i,
        fy = y / 4 - j;
      const top = hash(i, j) * (1 - fx) + hash(i + 1, j) * fx,
        bottom = hash(i, j + 1) * (1 - fx) + hash(i + 1, j + 1) * fx;
      return top * (1 - fy) + bottom * fy;
    };
    // Textured parts: flat colours would match anywhere inside a same-coloured part.
    const images = new Map(
      Object.entries(FIXTURE_IMAGES).map(([name, im]) => {
        const rgba = new Uint8Array(im.width * im.height * 4);
        for (let y = 0; y < im.height; y++)
          for (let x = 0; x < im.width; x++) {
            if (!im.inside((x + 0.5) / im.width, (y + 0.5) / im.height)) continue;
            // Value noise (4 px cells): fine and not periodic, so one placement matches.
            const k = 0.35 + 0.65 * noise(x, y);
            rgba.set(
              [im.color[0] * k, im.color[1] * (1.2 - k / 2), im.color[2] * k, 255],
              (y * im.width + x) * 4,
            );
          }
        return [name, { width: im.width, height: im.height, rgba }];
      }),
    );
    const plan = clone(fixturePlan());
    const unposed = buildCharacter(plan, fixtureLayout());
    // The fixture's body is a spine-to-head gradient: turning the spine keeps every part rigid.
    plan.motion.animations[0]!.pose = { spine: { rotate: 6 }, arm_r: { rotate: -10 } };
    const posed = buildCharacter(plan, fixtureLayout());
    const viewBox = { x: -60, y: 305, width: 120, height: 310 },
      scale = 3;
    const sk = loadSkeleton(posed.document);
    pose(sk, "IDLE", 0);
    const tex = (p: string) => {
      const im = images.get(p)!;
      return premultiply(im.width, im.height, im.rgba);
    };
    const canvas = render(sk, tex, {
      x0: viewBox.x,
      y0: viewBox.y,
      scale,
      width: viewBox.width * scale,
      height: viewBox.height * scale,
    });
    const reference = new Uint8Array(canvas.length);
    for (let i = 0; i < canvas.length; i += 4) {
      const a = Math.min(1, canvas[i + 3]!);
      reference[i + 3] = Math.round(a * 255);
      for (let k = 0; k < 3; k++)
        reference[i + k] = a > 0 ? Math.round(Math.min(1, canvas[i + k]! / a) * 255) : 0;
    }
    const fit = fitRestPose(
      unposed.document,
      "IDLE",
      { width: viewBox.width * scale, height: viewBox.height * scale, rgba: reference },
      (p) => images.get(p)!,
      {
        view: viewBox,
        bones: unposed.rigging.rigged.rig.bones
          .map((b) => b.id)
          .filter((id) => !["root", "face_base", "face_ctl", "face_counter", "eyes"].includes(id)),
        window: 40,
      },
    );
    expect(fit.pose.spine?.rotate).toBeCloseTo(6, 0);
    expect(fit.pose.arm_r?.rotate).toBeCloseTo(-10, 0);
    expect(Math.abs(fit.pose.head?.rotate ?? 0)).toBeLessThan(0.5);
    // Bones that start on their parent's joint only turn.
    expect(fit.pose.spine?.x).toBeUndefined();
    expect(fit.residual.median).toBeLessThan(1.5);
  });

  it("measures the frame-0 pose against the artist and scores A1 on shown slots", () => {
    const plan = clone(fixturePlan());
    const artist = buildCharacter(plan, fixtureLayout());
    plan.motion.animations[0]!.pose = { head: { rotate: 12 } };
    const build = buildCharacter(plan, fixtureLayout());
    const d = restPoseDelta(
      sampleTracks(loadSkeleton(artist.document), "IDLE", 30),
      sampleTracks(loadSkeleton(build.document), "IDLE", 30),
    );
    expect(d.Leg_L).toBeLessThan(0.5);
    expect(d.Head).toBeGreaterThan(3);
    // The artist hides the eyes in IDLE; a misplaced hidden image does not fail A1.
    const art = clone(artist.document) as unknown as {
      animations: Record<string, { slots?: Record<string, object> }>;
    };
    art.animations.IDLE!.slots = {
      ...art.animations.IDLE!.slots,
      Eyes: {
        attachment: [
          { time: 0, name: null },
          { time: artist.animations[0]!.duration, name: null },
        ],
      },
    };
    const imagesOnly = fixtureImagesOnly() as unknown as Doc;
    (imagesOnly.skins[0]!.attachments.Eyes!.Eyes as { x: number }).x += 5;
    const probes = { ...plan.qa!.probes!, eyes: undefined };
    delete probes.eyes;
    const reference = prepareReference(art, imagesOnly, { probes });
    const { result } = compareToReference(reference, build.document, imagesOnly, { probes });
    expect(result.engineering.A1_imagesOnlyVsArtistSetup.maxPx).toBeLessThan(0.5);
    expect(result.engineering.A1_imagesOnlyVsArtistSetup.hiddenMaxPx).toBeGreaterThan(4);
    const a6 = result.engineering.A6_restPose.IDLE!;
    expect(a6.worst[0]![0]).toMatch(/Head|Hair/);
    const row = checkAcceptance(result, build.seams).rows.find((r) => r.id.startsWith("A6"))!;
    expect(row.ok).toBe(false);
  });

  it("draws only the bones that move shown parts", () => {
    const plan = clone(fixturePlan());
    const doc = buildCharacter(plan, fixtureLayout()).document as unknown as Doc;
    doc.bones.push({ name: "unused" } as Doc["bones"][number]);
    const sk = loadSkeleton(doc);
    pose(sk, "IDLE", 0);
    const bones = drivingBones(sk);
    expect(bones.has("unused")).toBe(false);
    expect(bones.has("head")).toBe(true);
    expect(bones.has("root")).toBe(true);
    expect(drawList(sk).length).toBeGreaterThan(0);
  });
});
