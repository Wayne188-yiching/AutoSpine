import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Value } from "@sinclair/typebox/value";
import {
  AnimationSpecSchema,
  BuildJobSchema,
  BuildManifestSchema,
  RigSpecSchema,
  type BuildJob,
  type RigSpec,
} from "@autospine/schemas";
import { parsePngParts } from "@autospine/assets";
import {
  evaluateRig,
  generateChainRig,
  inverseAffine,
  orderBones,
  rigFromWorldFrames,
  transformPoint,
  type Affine,
} from "@autospine/rig";
import { skinVertices, solveDistanceWeights, validateWeights } from "@autospine/weights";
import { generateWave, rotationsAt } from "@autospine/motion";
import { buildChainWave } from "@autospine/pipeline";
import { compileWeightedSpine40 } from "@autospine/spine";
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
import { beforeAll, describe, expect, it } from "vitest";

let directory: string, job: BuildJob, result: ReturnType<typeof buildChainWave>;
const cli = resolve("packages/cli/dist/index.js");
beforeAll(async () => {
  const root = await mkdtemp(resolve(tmpdir(), "autospine-toolchain-"));
  directory = resolve(root, "fixture");
  execFileSync(process.execPath, [resolve("fixtures/chain-wave/create-demo.mjs"), directory]);
  job = JSON.parse(await readFile(resolve(directory, "job.json"), "utf8")) as BuildJob;
  const asset = await parsePngParts(directory, {
    id: job.id + "-asset",
    name: job.name,
    sourcePath: "fish.png",
    manifest: {
      width: 160,
      height: 80,
      parts: [{ id: job.id + "-part", name: job.name, file: "fish.png", x: 0, y: 0, drawOrder: 0 }],
    },
  });
  result = buildChainWave(asset, job);
});

function officialSkeleton(rig = result.rig) {
  const document = compileWeightedSpine40({
    ...result,
    rig,
    weights: solveDistanceWeights(result.mesh, rig),
    animation: generateWave(rig, job.wave),
    imagesPath: "./images/",
  });
  const atlas = new TextureAtlas(
    "image.png\nsize: 160,80\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nimage\n  rotate: false\n  xy: 0, 0\n  size: 160, 80\n  orig: 160, 80\n  offset: 0, 0\n  index: -1\n",
  );
  atlas.pages[0]!.setTexture(new FakeTexture({ width: 160, height: 80 } as HTMLImageElement));
  return new Skeleton(
    new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(document),
  );
}
function officialVertices(skeleton: Skeleton) {
  skeleton.updateWorldTransform();
  const attachment = skeleton.slots[0]!.getAttachment() as MeshAttachment;
  const output = new Array<number>(attachment.worldVerticesLength).fill(0);
  attachment.computeWorldVertices(skeleton.slots[0]!, 0, output.length, output, 0, 2);
  return output;
}
function reordered(points: [number, number][]) {
  const hull = new Set(result.mesh.hull);
  return [
    ...result.mesh.hull,
    ...result.mesh.vertices.map((_, i) => i).filter((i) => !hull.has(i)),
  ].flatMap((i) => [points[i]![0], -points[i]![1]]);
}

describe("unattended chain-wave production slice", () => {
  it("keeps the file job strict and bounded without adding a ninth IR", () => {
    expect(Value.Check(BuildJobSchema, job)).toBe(true);
    for (const altered of [
      { ...job, expectedArtistMesh: {} },
      { ...job, profile: "human" },
      { ...job, chain: { ...job.chain, boneCount: 65 } },
      { ...job, wave: { ...job.wave, fps: 61 } },
    ])
      expect(Value.Check(BuildJobSchema, altered)).toBe(false);
  });
  it("builds blind mesh and reports functional status without quality acceptance", () => {
    expect(result.mesh.vertices.length).toBeGreaterThan(3);
    expect(result.rig.bones).toHaveLength(5);
    expect(result.diagnostics.referenceConditioned).toBe(false);
    expect(result.diagnostics.explicitChainInput).toBe(true);
    expect(result.diagnostics.qualityAccepted).toBe(false);
    expect(result.diagnostics.deformation.loopMaxDelta).toBe(0);
    expect(Object.values(result.diagnostics.deformation).every(Number.isFinite)).toBe(true);
  });
  it("restores every setup vertex and normalizes at most two influences", () => {
    const setup = skinVertices(result.mesh, result.rig, result.weights);
    setup.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(result.mesh.vertices[i]![0], 10);
      expect(p[1]).toBeCloseTo(result.mesh.vertices[i]![1], 10);
    });
    result.weights.vertices.forEach((v) => {
      expect(v.influences.length).toBeLessThanOrEqual(2);
      expect(v.influences.reduce((s, i) => s + i.weight, 0)).toBeCloseTo(1, 12);
    });
  });
  it.each(["missing", "duplicate", "foreign", "sum"])("rejects %s weight corruption", (kind) => {
    const weights = structuredClone(result.weights);
    if (kind === "missing") weights.vertices.pop();
    if (kind === "duplicate") weights.vertices.push(weights.vertices[0]!);
    if (kind === "foreign") weights.vertices[0]!.influences[0]!.boneId = "absent";
    if (kind === "sum") weights.vertices[0]!.influences[0]!.weight = 0;
    expect(() => validateWeights(result.mesh, result.rig, weights)).toThrow();
  });
  it("bakes ordered seamless wave keys and actually moves the mesh", () => {
    expect(Value.Check(AnimationSpecSchema, result.animation)).toBe(true);
    for (const t of result.animation.rotationTimelines!) {
      expect(t.keys[0]!.time).toBe(0);
      expect(t.keys.at(-1)!.time).toBe(job.wave.duration);
      expect(t.keys.at(-1)!.degrees).toBe(t.keys[0]!.degrees);
    }
    const posed = skinVertices(
      result.mesh,
      result.rig,
      result.weights,
      rotationsAt(result.animation, 0.5),
    );
    expect(
      posed.some(
        (p, i) =>
          Math.hypot(p[0] - result.mesh.vertices[i]![0], p[1] - result.mesh.vertices[i]![1]) > 1,
      ),
    ).toBe(true);
  });
  it("orders child-first frames and rejects cycles, duplicate IDs and missing parents", () => {
    expect(orderBones([...result.rig.bones].reverse())).toEqual(result.rig.bones);
    const root = result.rig.bones[0]!,
      child = result.rig.bones[1]!;
    for (const bones of [
      [root, root],
      [{ ...root, parentId: child.id }, child],
      [{ ...root, parentId: "absent" }],
    ])
      expect(() => orderBones(bones)).toThrow();
    expect(() => inverseAffine([1, 0, 1, 0, 0, 0])).toThrow();
  });
  it("round-trips scaled, sheared and reflected world frames into neutral RigSpec", () => {
    const source: RigSpec = {
      ...result.rig,
      bones: result.rig.bones.map((b, i) => ({
        ...b,
        scaleX: i === 0 ? -1.2 : 1.1,
        scaleY: 0.9,
        shearX: 3,
        shearY: 14,
      })),
    };
    const frames = evaluateRig(source),
      assembled = rigFromWorldFrames(
        "assembled",
        "Assembled",
        [...source.bones].reverse().map((b) => ({
          id: b.id,
          name: b.name,
          parentId: b.parentId,
          length: b.length,
          world: frames.get(b.id)!,
        })),
      );
    expect(Value.Check(RigSpecSchema, assembled)).toBe(true);
    for (const [id, m] of evaluateRig(assembled))
      m.forEach((v, i) => expect(v).toBeCloseTo(frames.get(id)![i]!, 9));
  });
  it("matches official 4.0 weighted setup coordinates", () => {
    const actual = officialVertices(officialSkeleton()),
      expected = reordered(result.mesh.vertices);
    actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 4));
  });
  it.each([0, 0.031, 0.5, 1, 1.97, 2])("matches official runtime wave at %s seconds", (time) => {
    const skeleton = officialSkeleton();
    skeleton.setToSetupPose();
    skeleton.data.animations[0]!.apply(
      skeleton,
      0,
      time,
      false,
      [],
      1,
      MixBlend.setup,
      MixDirection.mixIn,
    );
    const actual = officialVertices(skeleton),
      expected = reordered(
        skinVertices(result.mesh, result.rig, result.weights, rotationsAt(result.animation, time)),
      );
    actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 3));
  });
  it("exports negative scale and shear consistently with the official runtime", () => {
    const rig = {
      ...result.rig,
      bones: result.rig.bones.map((b, i) => ({
        ...b,
        scaleX: i === 0 ? -1 : 1.1,
        scaleY: 0.8,
        shearX: 5,
        shearY: 12,
      })),
    };
    const actual = officialVertices(officialSkeleton(rig));
    const expected = reordered(result.mesh.vertices);
    actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 3));
  });
  it("keeps automatic triangles separate from authored hull/manual edges", () => {
    const doc = compileWeightedSpine40({ ...result, imagesPath: "./images/" }),
      attachment = doc.skins[0]!.attachments.image.image;
    expect(attachment.hull).toBe(result.mesh.hull.length);
    expect(attachment.edges.length).toBe(result.mesh.hull.length * 2);
    expect(attachment.triangles.length).toBe(result.mesh.triangles.length);
  });
  it("rejects stale references and malformed timeline ends", () => {
    expect(() =>
      compileWeightedSpine40({
        ...result,
        animation: { ...result.animation, rigId: "stale" },
        imagesPath: "./images/",
      }),
    ).toThrow();
    const animation = structuredClone(result.animation);
    animation.rotationTimelines![0]!.keys.pop();
    expect(() =>
      compileWeightedSpine40({ ...result, animation, imagesPath: "./images/" }),
    ).toThrow();
  });
  it("serializes wave, weights and adapter identically over 100 runs", () => {
    const expected = JSON.stringify(compileWeightedSpine40({ ...result, imagesPath: "./images/" }));
    for (let i = 0; i < 100; i++)
      expect(
        JSON.stringify(
          compileWeightedSpine40({
            ...result,
            weights: solveDistanceWeights(result.mesh, result.rig),
            animation: generateWave(result.rig, job.wave),
            imagesPath: "./images/",
          }),
        ),
      ).toBe(expected);
  });
  it("keeps new engines free of adapters, experiments and AI", () => {
    for (const module of ["weights", "motion", "pipeline"]) {
      const source = readFileSync(resolve(`packages/${module}/src/index.ts`), "utf8");
      expect(source).not.toMatch(/@autospine\/spine|tools\/|node:fs|typesafe|api\.openai/);
    }
  });
  it("CLI delivers a complete manifest and deterministic no-overwrite bundle", async () => {
    const path = resolve(directory, "job.json");
    const before = await readFile(resolve(directory, "fish.png"));
    execFileSync(process.execPath, [cli, "build", path]);
    const output = resolve(directory, "build"),
      manifest = JSON.parse(await readFile(resolve(output, "manifest.json"), "utf8"));
    expect(Value.Check(BuildManifestSchema, manifest)).toBe(true);
    for (const file of manifest.outputs as string[]) await access(resolve(output, file));
    expect(await readFile(resolve(directory, "fish.png"))).toEqual(before);
    expect(() => execFileSync(process.execPath, [cli, "build", path], { stdio: "pipe" })).toThrow();
    const other = resolve(directory, "other.json");
    await writeFile(other, JSON.stringify({ ...job, output: "other" }));
    execFileSync(process.execPath, [cli, "build", other]);
    for (const file of manifest.outputs as string[])
      expect(await readFile(resolve(output, file))).toEqual(
        await readFile(resolve(directory, "other", file)),
      );
  });
  it("CLI rejects invalid jobs without creating output", async () => {
    const file = resolve(directory, "bad.json");
    await writeFile(file, JSON.stringify({ ...job, output: "bad", wave: { ...job.wave, fps: 0 } }));
    expect(() => execFileSync(process.execPath, [cli, "build", file], { stdio: "pipe" })).toThrow();
    await expect(access(resolve(directory, "bad"))).rejects.toThrow();
  });
  it("uses ordinary mathematical inverse transforms, not stored artist coordinates", () => {
    const m: Affine = [2, 0.3, 0.4, 1.2, 5, -7],
      p: [number, number] = [9, 11],
      roundtrip = transformPoint(inverseAffine(m), transformPoint(m, p));
    expect(roundtrip[0]).toBeCloseTo(p[0], 12);
    expect(roundtrip[1]).toBeCloseTo(p[1], 12);
    expect(() =>
      generateChainRig({ ...job.chain, id: "zero", name: "zero", end: job.chain.start }),
    ).toThrow();
  });
  it("rejects singular supplied root frames", () => {
    expect(() =>
      rigFromWorldFrames("singular", "Singular", [
        { id: "root", name: "root", length: 1, world: [1, 0, 2, 0, 0, 0] },
      ]),
    ).toThrow();
  });
  it("CLI reports unreadable or malformed JSON with structured stage and code", async () => {
    const path = resolve(directory, "broken.json");
    await writeFile(path, "{");
    try {
      execFileSync(process.execPath, [cli, "build", path], { stdio: "pipe" });
      throw new Error("unexpected success");
    } catch (error) {
      const stderr = (error as { stderr?: Buffer }).stderr?.toString();
      expect(stderr).toContain('"stage":"build"');
      expect(stderr).toContain("BUILD_JOB_READ");
    }
  });
});

describe.skipIf(!process.env.AUTOSPINE_ROUNDTRIP_DIR)("real Spine 4.0.64 editor round-trip", () => {
  it("retains weighted setup and wave positions through project import and export", async () => {
    const root = resolve(process.env.AUTOSPINE_ROUNDTRIP_DIR!),
      document = JSON.parse(await readFile(resolve(root, "editor-export/skeleton.json"), "utf8"));
    const atlas = new TextureAtlas(
      await readFile(resolve(root, "editor-export/fish.atlas"), "utf8"),
    );
    // Atlas header provides the real packed page dimensions; no GPU image upload needed.
    for (const page of atlas.pages)
      page.setTexture(
        new FakeTexture({ width: page.width, height: page.height } as HTMLImageElement),
      );
    const skeleton = new Skeleton(
      new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(document),
    );
    expect(skeleton.bones).toHaveLength(result.rig.bones.length);
    let maxError = 0;
    const check = (expected: number[]) =>
      officialVertices(skeleton).forEach((v, i) => {
        maxError = Math.max(maxError, Math.abs(v - expected[i]!));
      });
    check(reordered(result.mesh.vertices));
    const times = [...result.frames.map((f) => f.time), 0.031, 1.97];
    for (const time of times) {
      skeleton.setToSetupPose();
      skeleton.data.animations[0]!.apply(
        skeleton,
        0,
        time,
        false,
        [],
        1,
        MixBlend.setup,
        MixDirection.mixIn,
      );
      check(
        reordered(
          skinVertices(
            result.mesh,
            result.rig,
            result.weights,
            rotationsAt(result.animation, time),
          ),
        ),
      );
    }
    expect(maxError).toBeLessThan(0.05);
    expect(skeleton.data.animations[0]!.duration).toBe(2);
    const report = {
      editor: "4.0.64",
      runtime: "4.0.31",
      sampleTimes: times.length,
      vertices: result.mesh.vertices.length,
      bones: result.rig.bones.length,
      maxCoordinateError: maxError,
      tolerance: 0.05,
      passed: true,
      guiPlaybackVerified: false,
      qualityAccepted: false,
    };
    await writeFile(resolve(root, "roundtrip-audit.json"), JSON.stringify(report, null, 2) + "\n", {
      flag: "wx",
    });
  });
});
