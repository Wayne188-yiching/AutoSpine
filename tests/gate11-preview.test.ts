import { beforeAll, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { parsePngParts } from "@autospine/assets";
import { buildChainWave } from "@autospine/pipeline";
import { generatePreset, presetNames, sampleAnimation } from "@autospine/motion";
import { skinVertices } from "@autospine/weights";
import { compileWeightedSpine40 } from "@autospine/spine";
import {
  AtlasAttachmentLoader,
  FakeTexture,
  TextureAtlas,
  SkeletonJson,
  Skeleton,
  MeshAttachment,
  MixBlend,
  MixDirection,
} from "@esotericsoftware/spine-core";
import { previewHtml } from "../packages/cli/src/preview.js";
import type { BuildJob } from "@autospine/schemas";

let directory: string, result: ReturnType<typeof buildChainWave>;
beforeAll(async () => {
  const root = await mkdtemp(resolve(tmpdir(), "autospine-preview-"));
  directory = resolve(root, "demo");
  execFileSync(process.execPath, [resolve("fixtures/chain-wave/create-demo.mjs"), directory]);
  const job = JSON.parse(await readFile(resolve(directory, "job.json"), "utf8")) as BuildJob;
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
it("Gate 11 every preset maps to the official 4.0 Runtime including translation and scale", () => {
  for (const type of presetNames) {
    const animation = generatePreset(result.rig, {
      type,
      duration: 2,
      fps: 60,
      amplitude: 8,
      seed: 42,
    });
    const doc = compileWeightedSpine40({ ...result, animation, imagesPath: "./images/" });
    const atlas = new TextureAtlas(
      "image.png\nsize: 160,80\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nimage\n  rotate: false\n  xy: 0, 0\n  size: 160, 80\n  orig: 160, 80\n  offset: 0, 0\n  index: -1\n",
    );
    atlas.pages[0]!.setTexture(new FakeTexture({ width: 160, height: 80 } as HTMLImageElement));
    const skeleton = new Skeleton(
      new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(doc),
    );
    const hull = new Set(result.mesh.hull),
      order = [
        ...result.mesh.hull,
        ...result.mesh.vertices.map((_, i) => i).filter((i) => !hull.has(i)),
      ];
    for (const time of [0, 0.25, 0.5, 0.75, 1, 1.037, 2]) {
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
      skeleton.updateWorldTransform();
      const attachment = skeleton.slots[0]!.getAttachment() as MeshAttachment,
        actual = new Array<number>(attachment.worldVerticesLength).fill(0);
      attachment.computeWorldVertices(skeleton.slots[0]!, 0, actual.length, actual, 0, 2);
      const pose = sampleAnimation(animation, result.rig, time),
        points = skinVertices(result.mesh, result.rig, result.weights, pose.rotations, pose);
      order.forEach((j, i) => {
        expect(actual[2 * i], type + " x at " + time).toBeCloseTo(points[j]![0], 3);
        expect(actual[2 * i + 1], type + " y at " + time).toBeCloseTo(-points[j]![1], 3);
      });
    }
  }
});
it("Gate 11 fixed-time preview is deterministic and manifest-bound, provenance checks all outputs", async () => {
  const png = await readFile(resolve(directory, "fish.png"));
  const html = previewHtml(result, png.toString("base64"), "review-manifest");
  expect(html).toContain('"manifestId":"review-manifest"');
  expect(html).toContain("fixedTime");
  expect(html).toContain("URLSearchParams");
  expect(previewHtml(result, png.toString("base64"), "review-manifest")).toBe(html);
  execFileSync(process.execPath, [
    resolve("packages/cli/dist/index.js"),
    "build",
    resolve(directory, "job.json"),
  ]);
  const provenance = JSON.parse(
    await readFile(resolve(directory, "build/provenance.json"), "utf8"),
  );
  const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");
  expect(provenance.sourceSha256).toBe(sha(png));
  for (const [file, hash] of Object.entries(provenance.hashes))
    expect(sha(await readFile(resolve(directory, "build", file)))).toBe(hash);
});
it("Gate 11 rejects non-exportable deform channels rather than dropping them", () => {
  const animation = structuredClone(result.animation);
  animation.deformTimelines = [
    {
      meshId: result.mesh.id,
      keys: [
        { time: 0, offsets: [[0, 0]] },
        { time: 2, offsets: [[0, 0]] },
      ],
    },
  ];
  expect(() => compileWeightedSpine40({ ...result, animation, imagesPath: "./images/" })).toThrow(
    /deform/,
  );
});
