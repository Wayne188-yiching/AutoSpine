import { analyzeImageRegions } from "@autospine/rig";
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { PNG } from "pngjs";

function image(width: number, height: number, points: [number, number][]) {
  const rgba = new Uint8Array(width * height * 4);
  for (const [x, y] of points) rgba.set([40, 100, 160, 255], (y * width + x) * 4);
  return { width, height, rgba };
}

describe("PNG-only image evidence", () => {
  it("preserves every foreground pixel, including faint disconnected details", () => {
    const input = image(8, 5, [
      [0, 0],
      [1, 0],
      [7, 4],
    ]);
    input.rgba[(4 * 8 + 7) * 4 + 3] = 1;
    const result = analyzeImageRegions(input);
    expect(result.foregroundPixels).toBe(3);
    expect(result.regions.map((r) => r.pixels)).toEqual([2, 1]);
    expect(result.regions.reduce((sum, r) => sum + r.pixels, 0)).toBe(3);
    expect(result.reviewReasons).toContain("REGION_SELECTION_UNDETERMINED");
    expect(result.qualityAccepted).toBe(false);
  });

  it("does not join diagonal pixels or wrap one row into the next", () => {
    const result = analyzeImageRegions(
      image(3, 3, [
        [2, 0],
        [0, 1],
        [1, 2],
      ]),
    );
    expect(result.regions).toHaveLength(3);
    expect(result.regions.every((r) => r.pixels === 1)).toBe(true);
  });

  it("is invariant to hidden RGB values and never uses transparent background colour", () => {
    const input = image(5, 3, [
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
    const before = analyzeImageRegions(input);
    for (let i = 0; i < input.rgba.length; i += 4)
      if (!input.rgba[i + 3]) input.rgba.set([255, 0, 200], i);
    expect(analyzeImageRegions(input)).toEqual(before);
    expect(before.regions[0]!.meanRgb).toEqual([40, 100, 160]);
  });

  it("moves pixel evidence with the raster while preserving geometry", () => {
    const points: [number, number][] = [
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
    ];
    const a = analyzeImageRegions(image(10, 8, points)).regions[0]!;
    const b = analyzeImageRegions(
      image(
        10,
        8,
        points.map(([x, y]) => [x + 3, y + 4]),
      ),
    ).regions[0]!;
    expect(b.centroid).toEqual([a.centroid[0] + 3, a.centroid[1] + 4]);
    expect(b.axisEnds).toEqual(a.axisEnds!.map(([x, y]) => [x + 3, y + 4]));
    expect(b.anisotropy).toBe(a.anisotropy);
    expect(b.pixels).toBe(a.pixels);
    expect(b.meanRgb).toEqual(a.meanRgb);
  });

  it("reports an undirected image axis without guessing an anatomical pivot or bone count", () => {
    const result = analyzeImageRegions(
      image(6, 3, [
        [1, 1],
        [2, 1],
        [3, 1],
        [4, 1],
      ]),
    );
    expect(result.regions[0]!.axisEnds).toEqual([
      [1.5, 1.5],
      [4.5, 1.5],
    ]);
    expect(result.role).toBe("unknown");
    expect(result.pivot).toBeNull();
    expect(result.boneCount).toBeNull();
    expect(result.status).toBe("REVIEW_REQUIRED");
  });

  it("does not invent an orientation for an isotropic region or one pixel", () => {
    expect(
      analyzeImageRegions(
        image(2, 2, [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ]),
      ).regions[0]!.axisEnds,
    ).toBeNull();
    expect(analyzeImageRegions(image(1, 1, [[0, 0]])).regions[0]!.axisEnds).toBeNull();
  });

  it("is deterministic and leaves source pixels unchanged", () => {
    const input = image(5, 4, [
      [1, 1],
      [2, 1],
      [2, 2],
      [3, 2],
    ]);
    const pixels = input.rgba.slice();
    const baseline = analyzeImageRegions(input);
    for (let i = 0; i < 10; i++) expect(analyzeImageRegions(input)).toEqual(baseline);
    expect(input.rgba).toEqual(pixels);
  });

  it("rejects reference-field injection, dimension errors and excessive raster budgets", () => {
    const input = image(1, 1, [[0, 0]]);
    expect(() => analyzeImageRegions({ ...input, artistBones: [] } as never)).toThrow(
      "IMAGE_REGION_INPUT",
    );
    expect(() => analyzeImageRegions({ ...input, width: 0 })).toThrow("IMAGE_REGION_INPUT");
    expect(() => analyzeImageRegions({ ...input, width: 2001, height: 2000 })).toThrow(
      "IMAGE_REGION_INPUT",
    );
    expect(() => analyzeImageRegions({ ...input, rgba: new Uint8Array(3) })).toThrow(
      "IMAGE_REGION_INPUT",
    );
  });

  it("refuses excessive components instead of deleting or merging them to pass", () => {
    const points: [number, number][] = [];
    for (let y = 0; y < 129; y += 2) for (let x = 0; x < 129; x += 2) points.push([x, y]);
    expect(() => analyzeImageRegions(image(129, 129, points))).toThrow("IMAGE_REGION_BUDGET");
  });

  it("keeps an empty source unaccepted", () => {
    const result = analyzeImageRegions(image(2, 2, []));
    expect(result.status).toBe("EMPTY");
    expect(result.regions).toEqual([]);
    expect(result.qualityAccepted).toBe(false);
  });
});

describe("actual PNG worker input boundary", () => {
  const directory = mkdtempSync(join(tmpdir(), "autospine-image-evidence-"));
  const pngPath = join(directory, "image.png"),
    reference = join(directory, "artist.json");
  const input = image(6, 3, [
    [1, 1],
    [2, 1],
    [3, 1],
    [4, 1],
  ]);
  const png = new PNG({ width: input.width, height: input.height });
  png.data.set(input.rgba);
  writeFileSync(pngPath, PNG.sync.write(png));
  writeFileSync(reference, '{"boneCount":42}');
  afterAll(() => {
    const target = realpathSync(directory);
    if (
      dirname(target) !== realpathSync(tmpdir()) ||
      !basename(target).startsWith("autospine-image-evidence-")
    )
      throw new Error("Refusing unexpected cleanup target");
    rmSync(target, { recursive: true, force: true });
  });
  const worker = resolve("tools/png-rig-evidence.mjs");
  const allowed = [
    worker,
    resolve("package.json"),
    resolve("packages/rig/package.json"),
    resolve("packages/rig/dist/image-regions.js"),
    resolve("packages/rig/dist/image-connections.js"),
    resolve("packages/rig/dist/image-path.js"),
    resolve("node_modules/pngjs"),
    realpathSync(pngPath),
  ];
  const permissions = ["--permission", ...allowed.map((p) => `--allow-fs-read=${p}`)];
  const options = {
    encoding: "utf8" as const,
    env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" },
    windowsHide: true,
  };

  it("runs real PNG decoding with only the exact image and trusted code permitted", () => {
    const before = readFileSync(pngPath);
    const run = spawnSync(process.execPath, [...permissions, worker, "--worker", pngPath], options);
    expect(run.error).toBeUndefined();
    expect(run.status, run.stderr).toBe(0);
    const result = JSON.parse(run.stdout);
    expect(result.foregroundPixels).toBe(4);
    expect(result.boneCount).toBeNull();
    expect(result.pngSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(pngPath)).toEqual(before);
  });

  it("denies a sibling reference file and file writes under the identical allowlist", () => {
    const probe = `import {readFileSync,writeFileSync} from 'node:fs';
      const result=[];
      for(const operation of [()=>readFileSync(process.argv[1]),()=>writeFileSync(process.argv[2],'bad')]) {
        try {operation();result.push('ALLOWED')} catch(e) {result.push(e.code)}
      }
      console.log(JSON.stringify(result));`;
    const run = spawnSync(
      process.execPath,
      [...permissions, "--input-type=module", "--eval", probe, reference, pngPath],
      options,
    );
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual(["ERR_ACCESS_DENIED", "ERR_ACCESS_DENIED"]);
    expect(readFileSync(reference, "utf8")).toBe('{"boneCount":42}');
  });

  it("runs connection evidence inside the same PNG-only boundary", () => {
    const before = readFileSync(pngPath);
    const run = spawnSync(
      process.execPath,
      [...permissions, worker, "--connection-worker", pngPath],
      options,
    );
    expect(run.status, run.stderr).toBe(0);
    const result = JSON.parse(run.stdout);
    expect(result.kind).toBe("image-connection-evidence");
    expect(result.foregroundPixels).toBe(4);
    expect(result.selectedRegion).toBeNull();
    expect(result.regions[0].joint).toBeNull();
    expect(result.qualityAccepted).toBe(false);
    expect(readFileSync(pngPath)).toEqual(before);
  });

  it("runs path evidence inside the PNG-only boundary without inventing a rig", () => {
    const run = spawnSync(
      process.execPath,
      [...permissions, worker, "--path-worker", pngPath],
      options,
    );
    expect(run.status, run.stderr).toBe(0);
    const result = JSON.parse(run.stdout);
    expect(result.kind).toBe("image-path-evidence");
    expect(result.path).toBeNull();
    expect(result.foregroundPixels).toBe(4);
    expect(result.root).toBeNull();
    expect(result.boneCount).toBeNull();
    expect(result.qualityAccepted).toBe(false);
  });

  it("rejects a worker started without its permission boundary", () => {
    const run = spawnSync(process.execPath, [worker, "--worker", pngPath], options);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("requires explicit filesystem permissions");
  });

  it.each(["invalid", "oversized"])("rejects a %s PNG header before raster decode", (kind) => {
    const path = join(directory, `${kind}.png`);
    const bytes = readFileSync(pngPath);
    if (kind === "invalid") bytes[0] = 0;
    else bytes.writeUInt32BE(4_000_001, 16);
    writeFileSync(path, bytes);
    const run = spawnSync(
      process.execPath,
      [...permissions, `--allow-fs-read=${path}`, worker, "--worker", path],
      options,
    );
    expect(run.status).not.toBe(0);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain(
      kind === "invalid" ? "PNG header required" : "PNG pixel budget exceeded",
    );
  });

  function auditFixture(label: string) {
    const source = join(directory, `${label}.spine`);
    writeFileSync(source, "synthetic provenance fixture, not a Spine project");
    const sourceSha256 = createHash("sha256").update(readFileSync(source)).digest("hex");
    const exportDirectory = join(directory, label);
    const images = join(directory, `${label}-images`);
    mkdirSync(exportDirectory);
    mkdirSync(images);
    writeFileSync(join(images, "image.png"), readFileSync(pngPath));
    return {
      id: "fixture",
      source,
      sourceSha256,
      exportDirectory,
      exportExit: 0,
      images,
    };
  }

  it("retains failed reference identities and analyzes a shared PNG only once", () => {
    const source = auditFixture("inventory");
    const attachment = { type: "mesh", width: 6, height: 3, path: "image" };
    const document = {
      skeleton: { spine: "4.0.64" },
      skins: [
        {
          name: "default",
          attachments: {
            slot: {
              good: attachment,
              shared: attachment,
              missing: { ...attachment, path: "absent" },
              escaped: { ...attachment, path: "../image" },
            },
          },
        },
      ],
    };
    writeFileSync(join(source.exportDirectory, "export.json"), JSON.stringify(document));
    const config = join(directory, "inventory-config.json"),
      output = join(directory, "inventory-report.json");
    writeFileSync(config, JSON.stringify([source]));
    const run = spawnSync(
      process.execPath,
      [resolve("tools/png-rig-source-audit.mjs"), config, output],
      options,
    );
    expect(run.status, run.stderr).toBe(0);
    const report = JSON.parse(readFileSync(output, "utf8"));
    expect(report.cases).toHaveLength(4);
    expect(report.summary).toMatchObject({ meshCases: 4, uniquePngsAnalyzed: 1, sourceBlocked: 2 });
    expect(
      report.cases.filter((c: { status: string }) => c.status === "SOURCE_BLOCKED"),
    ).toHaveLength(2);
    expect(
      report.cases.find((c: { attachment: string }) => c.attachment === "escaped").reason,
    ).toBe("Image outside authorized source root");
    expect(report.carryover23.identified).toBeNull();
    expect(report.carryover23.qualityAccepted).toBe(0);
  });

  it("refuses stale source hashes before claiming a source inventory", () => {
    const source = auditFixture("stale");
    const config = join(directory, "stale-config.json"),
      output = join(directory, "stale-report.json");
    writeFileSync(config, JSON.stringify([{ ...source, sourceSha256: "wrong" }]));
    const run = spawnSync(
      process.execPath,
      [resolve("tools/png-rig-source-audit.mjs"), config, output],
      options,
    );
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("provenance mismatch");
    expect(() => readFileSync(output)).toThrow();
  });
});
