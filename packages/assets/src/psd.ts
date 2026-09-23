import { getLayerImageData, initializeCanvas, readPsd, type Layer } from "ag-psd";
import type { AssetGroup, AssetPart, AssetSpec } from "@autospine/schemas";
import { alphaPivot, encodeAlphaMask } from "./alpha-mask.js";
import { acceptAsset, failAsset } from "./validation.js";

// ag-psd requires an ImageData factory even when bitmap decoding avoids Canvas.
initializeCanvas(
  () => {
    throw new Error("Canvas rendering is outside Gate 2");
  },
  (width, height) =>
    ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) as ImageData,
);

export interface PsdOptions {
  id: string;
  name: string;
  sourcePath: string;
}

interface Leaf {
  layer: Layer;
  path: string;
  parentId?: string;
  bounds: { x: number; y: number; width: number; height: number };
}

/** Parses clean, 8-bit RGB raster PSDs. Source bytes are never modified. */
export function parsePsd(bytes: Uint8Array, options: PsdOptions): AssetSpec {
  if (bytes.byteLength > 64 * 1024 * 1024)
    failAsset("PSD_TOO_LARGE", "PSD exceeds the 64 MiB input limit");
  let psd;
  try {
    psd = readPsd(bytes, {
      useRawData: true,
      useRawThumbnail: true,
      skipCompositeImageData: true,
      skipLinkedFilesData: true,
      totalMemoryLimit: 128 * 1024 * 1024,
    });
  } catch {
    failAsset("PSD_INVALID", "PSD could not be parsed");
  }
  if (
    !Number.isInteger(psd.width) ||
    !Number.isInteger(psd.height) ||
    psd.width < 1 ||
    psd.height < 1 ||
    psd.width > 8192 ||
    psd.height > 8192 ||
    psd.width * psd.height > 25_000_000
  )
    failAsset("PSD_DIMENSIONS", "PSD canvas dimensions exceed Gate 2 limits");
  if ((psd.bitsPerChannel ?? 8) !== 8 || (psd.colorMode ?? 3) !== 3)
    failAsset("PSD_COLOR_MODE", "Gate 2 supports only 8-bit RGB PSD files");
  const groups: AssetGroup[] = [];
  const leaves: Leaf[] = [];
  let nodeCount = 0,
    totalPixels = 0;
  function walk(layers: Layer[], parentId?: string, prefix = ""): void {
    for (let index = 0; index < layers.length; index++) {
      const layer = layers[index]!;
      const path = prefix ? `${prefix}/${index}` : String(index);
      if (++nodeCount > 512) failAsset("PSD_LAYER_COUNT", "PSD has more than 512 layers/groups");
      if (!layer.name) failAsset("PSD_LAYER_NAME", "PSD layer/group has no name", path);
      if (
        (layer.opacity ?? 1) !== 1 ||
        layer.clipping === true ||
        (layer.blendMode &&
          layer.blendMode !== "normal" &&
          !(layer.children && layer.blendMode === "pass through"))
      )
        failAsset(
          "PSD_COMPOSITING_UNSUPPORTED",
          "Layer opacity, clipping, or blend mode is not supported",
          path,
        );
      if (layer.children) {
        const id = `group-${path.replaceAll("/", "-")}`;
        groups.push({
          id,
          name: layer.name,
          visible: layer.hidden !== true,
          ...(parentId ? { parentId } : {}),
        });
        walk(layer.children, id, path);
        continue;
      }
      if (
        layer.text ||
        layer.adjustment ||
        layer.placedLayer ||
        layer.vectorFill ||
        layer.mask ||
        layer.realMask ||
        layer.effects
      )
        failAsset(
          "PSD_LAYER_UNSUPPORTED",
          "Gate 2 supports raster layers without masks or effects",
          path,
        );
      const { left, top, right, bottom } = layer;
      if (![left, top, right, bottom].every(Number.isInteger))
        failAsset("PSD_LAYER_BOUNDS", "PSD raster layer bounds are missing", path);
      const width = right! - left!,
        height = bottom! - top!;
      if (width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 25_000_000)
        failAsset("PSD_LAYER_BOUNDS", "PSD raster layer bounds are unsupported", path);
      totalPixels += width * height;
      if (totalPixels > 25_000_000)
        failAsset("PSD_PIXEL_BUDGET", "PSD layer pixels exceed Gate 2 budget");
      leaves.push({ layer, path, parentId, bounds: { x: left!, y: top!, width, height } });
    }
  }
  walk(psd.children ?? []);
  if (!leaves.length) failAsset("PSD_NO_RASTER", "PSD has no raster layers");
  // Photoshop lists topmost first; AssetSpec drawOrder 0 is backmost.
  const parts: AssetPart[] = [];
  for (const leaf of leaves.reverse()) {
    let image;
    try {
      image = getLayerImageData(leaf.layer);
    } catch (error) {
      failAsset(
        "PSD_LAYER_DECODE",
        `PSD raster layer cannot be decoded: ${error instanceof Error ? error.message : "unknown error"}`,
        leaf.path,
      );
    }
    if (
      !image ||
      image.width !== leaf.bounds.width ||
      image.height !== leaf.bounds.height ||
      image.data.BYTES_PER_ELEMENT !== 1 ||
      image.data.length !== image.width * image.height * 4
    )
      failAsset("PSD_LAYER_DECODE", "PSD raster pixel data does not match bounds", leaf.path);
    const alpha = new Uint8Array(image.width * image.height);
    for (let index = 0; index < alpha.length; index++) alpha[index] = image.data[index * 4 + 3]!;
    const pivotCandidate = alphaPivot(alpha, image.width, image.height, leaf.bounds);
    if (!pivotCandidate)
      failAsset("EMPTY_ALPHA", "PSD raster layer has no visible pixels", leaf.path);
    parts.push({
      id: `layer-${leaf.path.replaceAll("/", "-")}`,
      name: leaf.layer.name!,
      sourcePath: `${options.sourcePath}#layer/${leaf.path}`,
      ...(leaf.parentId ? { parentId: leaf.parentId } : {}),
      bounds: leaf.bounds,
      pivotCandidate,
      drawOrder: parts.length,
      visible: leaf.layer.hidden !== true,
      alphaMask: encodeAlphaMask(image.width, image.height, alpha),
    });
  }
  return acceptAsset({
    schemaVersion: "0.1",
    kind: "asset",
    id: options.id,
    name: options.name,
    source: { type: "psd", path: options.sourcePath },
    width: psd.width,
    height: psd.height,
    ...(groups.length ? { groups } : {}),
    parts,
  });
}
