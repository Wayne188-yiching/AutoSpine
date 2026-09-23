import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { writePsdBuffer, type Psd } from "ag-psd";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";

import { AssetSpecSchema } from "@autospine/schemas";
import { Value } from "@sinclair/typebox/value";
import {
  AssetParseError,
  decodeAlphaMask,
  encodeAlphaMask,
  parsePngParts,
  parsePsd,
  validateAssetSpec,
  type PngPartsManifest,
} from "@autospine/assets";

const temporaryDirectories: string[] = [];
const fixtureRoot = resolve(process.cwd(), "fixtures/assets");
async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "autospine-gate2-"));
  temporaryDirectories.push(directory);
  return directory;
}
afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true });
});

function png(width: number, height: number, alpha: number[]): Buffer {
  const image = new PNG({ width, height });
  for (let pixel = 0; pixel < alpha.length; pixel++) {
    image.data[pixel * 4] = 100;
    image.data[pixel * 4 + 1] = 150;
    image.data[pixel * 4 + 2] = 200;
    image.data[pixel * 4 + 3] = alpha[pixel]!;
  }
  return PNG.sync.write(image);
}

function raster(name: string, left: number, top: number, alpha: number[]) {
  const data = new Uint8ClampedArray(2 * 2 * 4);
  for (let pixel = 0; pixel < alpha.length; pixel++) {
    data[pixel * 4] = 200;
    data[pixel * 4 + 3] = alpha[pixel]!;
  }
  return { name, left, top, imageData: { width: 2, height: 2, data } };
}

describe("Gate 2 asset parser", () => {
  it("round-trips exact 8-bit alpha including partial transparency", () => {
    const mask = encodeAlphaMask(4, 1, Uint8Array.from([0, 0, 128, 255]));
    expect(mask.runs).toEqual([2, 0, 1, 128, 1, 255]);
    expect(Array.from(decodeAlphaMask(mask))).toEqual([0, 0, 128, 255]);
  });

  it("parses PNG bounds, groups, display size, pivot, alpha and explicit draw order", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "front.png"), png(2, 2, [0, 255, 0, 0]));
    await writeFile(join(directory, "back.png"), png(2, 2, [255, 0, 0, 255]));
    const manifest: PngPartsManifest = {
      width: 20,
      height: 20,
      groups: [{ id: "character", name: "Character" }],
      parts: [
        {
          id: "front",
          name: "Front",
          file: "front.png",
          x: 3,
          y: 5,
          width: 4,
          height: 4,
          parentId: "character",
          drawOrder: 1,
        },
        {
          id: "back",
          name: "Back",
          file: "back.png",
          x: 1,
          y: 2,
          parentId: "character",
          drawOrder: 0,
        },
      ],
    };
    const asset = await parsePngParts(directory, {
      id: "asset-test",
      name: "Test",
      sourcePath: "assets/test",
      manifest,
    });
    expect(Value.Check(AssetSpecSchema, asset)).toBe(true);
    expect(asset).toEqual(
      JSON.parse(await readFile(join(fixtureRoot, "png-parts.expected.json"), "utf8")),
    );
    expect(asset.groups).toEqual([{ id: "character", name: "Character" }]);
    expect(asset.parts.map((part) => part.id)).toEqual(["back", "front"]);
    expect(asset.parts[1]?.bounds).toEqual({ x: 3, y: 5, width: 4, height: 4 });
    expect(asset.parts[1]?.alphaMask?.width).toBe(2);
    expect(asset.parts[1]?.pivotCandidate).toEqual([6, 6]);
    expect(Array.from(decodeAlphaMask(asset.parts[1]!.alphaMask!))).toEqual([0, 255, 0, 0]);
    expect(validateAssetSpec(asset).status).toBe("passed");
    expect(JSON.parse(JSON.stringify(asset))).toEqual(asset);
    const serialized = JSON.stringify(asset);
    for (let run = 0; run < 20; run++)
      expect(
        JSON.stringify(
          await parsePngParts(directory, {
            id: "asset-test",
            name: "Test",
            sourcePath: "assets/test",
            manifest,
          }),
        ),
      ).toBe(serialized);
  });

  it("uses stable filename order for a flat PNG directory without a manifest", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "z.png"), png(1, 1, [255]));
    await writeFile(join(directory, "a.png"), png(1, 1, [255]));
    const asset = await parsePngParts(directory, { id: "flat", name: "Flat", sourcePath: "flat" });
    expect(asset.parts.map((part) => [part.sourcePath, part.drawOrder])).toEqual([
      ["a.png", 0],
      ["z.png", 1],
    ]);
    expect(asset.parts.every((part) => part.bounds.x === 0 && part.bounds.y === 0)).toBe(true);
  });

  it("rejects unsafe paths and bad hierarchy with structured issues", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "safe.png"), png(1, 1, [255]));
    const base: PngPartsManifest = {
      width: 2,
      height: 2,
      parts: [{ id: "one", name: "One", file: "safe.png", x: 0, y: 0, drawOrder: 0 }],
    };
    const escaped: PngPartsManifest = {
      ...base,
      parts: [{ ...base.parts[0]!, file: "../escape.png" }],
    };
    await expect(
      parsePngParts(directory, { id: "x", name: "X", manifest: escaped }),
    ).rejects.toMatchObject({ validation: { issues: [{ code: "PATH_ESCAPE" }] } });
    const orphan: PngPartsManifest = {
      ...base,
      parts: [{ ...base.parts[0]!, parentId: "missing" }],
    };
    await expect(
      parsePngParts(directory, { id: "x", name: "X", manifest: orphan }),
    ).rejects.toMatchObject({ validation: { issues: [{ code: "PARENT_REFERENCE" }] } });
    const invalidParent: PngPartsManifest = {
      ...base,
      parts: [
        base.parts[0]!,
        { id: "two", name: "Two", file: "safe.png", x: 0, y: 0, drawOrder: 1, parentId: "one" },
      ],
    };
    await expect(
      parsePngParts(directory, { id: "x", name: "X", manifest: invalidParent }),
    ).rejects.toMatchObject({ validation: { issues: [{ code: "PARENT_NOT_GROUP" }] } });
    await writeFile(join(directory, "broken.png"), Buffer.from("not a PNG"));
    const broken: PngPartsManifest = {
      ...base,
      parts: [{ ...base.parts[0]!, file: "broken.png" }],
    };
    await expect(
      parsePngParts(directory, { id: "x", name: "X", manifest: broken }),
    ).rejects.toMatchObject({ validation: { issues: [{ code: "PNG_INVALID" }] } });
    expect((await readFile(join(directory, "safe.png"))).length).toBeGreaterThan(0);
  });

  it("parses a real layered PSD byte stream with group hierarchy and Photoshop order", () => {
    const psd: Psd = {
      width: 10,
      height: 10,
      children: [
        { name: "Body", hidden: true, children: [raster("Front", 3, 4, [0, 255, 0, 0])] },
        raster("Back", 1, 2, [255, 255, 255, 255]),
      ],
    };
    const bytes = writePsdBuffer(psd, { noBackground: true });
    const asset = parsePsd(bytes, { id: "psd-test", name: "PSD Test", sourcePath: "test.psd" });
    expect(Value.Check(AssetSpecSchema, asset)).toBe(true);
    expect(asset).toEqual(JSON.parse(readFileSync(join(fixtureRoot, "psd.expected.json"), "utf8")));
    expect(asset.groups).toEqual([{ id: "group-0", name: "Body", visible: false }]);
    expect(asset.parts.map((part) => [part.name, part.drawOrder, part.parentId])).toEqual([
      ["Back", 0, undefined],
      ["Front", 1, "group-0"],
    ]);
    expect(asset.parts[1]?.bounds).toEqual({ x: 3, y: 4, width: 2, height: 2 });
    expect(asset.parts[1]?.sourcePath).toBe("test.psd#layer/0/0");
    expect(asset.parts[1]?.pivotCandidate).toEqual([4.5, 4.5]);
    expect(Array.from(decodeAlphaMask(asset.parts[1]!.alphaMask!))).toEqual([0, 255, 0, 0]);
    expect(validateAssetSpec(asset).status).toBe("passed");
    expect(
      JSON.stringify(parsePsd(bytes, { id: "psd-test", name: "PSD Test", sourcePath: "test.psd" })),
    ).toBe(JSON.stringify(asset));
  });

  it("rejects malformed PSD bytes and invalid alpha runs explicitly", () => {
    expect(() =>
      parsePsd(Buffer.from("not a PSD"), {
        id: "broken",
        name: "Broken",
        sourcePath: "broken.psd",
      }),
    ).toThrow(AssetParseError);
    const malformed = { width: 2, height: 1, encoding: "rle8" as const, runs: [1, 255] };
    expect(() => decodeAlphaMask(malformed)).toThrow("pixel count mismatch");
  });

  it("rejects PSD compositing that AssetSpec cannot faithfully represent", () => {
    const psd: Psd = {
      width: 4,
      height: 4,
      children: [{ ...raster("Dimmed", 0, 0, [255, 255, 255, 255]), opacity: 0.5 }],
    };
    const bytes = writePsdBuffer(psd, { noBackground: true });
    expect(() => parsePsd(bytes, { id: "dim", name: "Dim", sourcePath: "dim.psd" })).toThrowError(
      AssetParseError,
    );
    try {
      parsePsd(bytes, { id: "dim", name: "Dim", sourcePath: "dim.psd" });
    } catch (error) {
      expect((error as AssetParseError).validation.issues[0]?.code).toBe(
        "PSD_COMPOSITING_UNSUPPORTED",
      );
    }
  });
});
