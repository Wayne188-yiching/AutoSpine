// Private inputs and generated previews belong outside the repository.
import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join, relative, isAbsolute } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { PNG } from "pngjs";
import console from "node:console";
import process from "node:process";
import { encodeAlphaMask } from "@autospine/assets";
import {
  generateMesh,
  generateMeshWithDiagnostics,
  prepareAlphaForMesh,
  validateMeshSpec,
} from "@autospine/mesh";
import { classifySpineMeshEdges } from "./spine-edge-classification.mjs";
import { compareArtistTopology } from "./artist-topology-policy.mjs";

function inside(polygon, x, y) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0])
      result = !result;
  }
  return result;
}

function metrics(points, hull, triangles, alpha, width, height) {
  const polygon = hull.map((i) => points[i]);
  let foreground = 0,
    missed = 0,
    added = 0,
    weightedMissed = 0,
    alphaTotal = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const value = alpha[y * width + x];
      const covered = inside(polygon, x + 0.5, y + 0.5);
      foreground += Number(value > 0);
      alphaTotal += value;
      if (value && !covered) {
        missed++;
        weightedMissed += value;
      }
      if (!value && covered) added++;
    }
  let below10 = 0,
    minAngle = 180;
  for (let i = 0; i < triangles.length; i += 3) {
    const p = triangles.slice(i, i + 3).map((v) => points[v]);
    const s = p.map((a, j) => Math.hypot(a[0] - p[(j + 1) % 3][0], a[1] - p[(j + 1) % 3][1]));
    const angle = Math.min(
      ...s.map(
        (v, j) =>
          (Math.acos(
            Math.max(
              -1,
              Math.min(
                1,
                (s[(j + 1) % 3] ** 2 + s[(j + 2) % 3] ** 2 - v ** 2) /
                  (2 * s[(j + 1) % 3] * s[(j + 2) % 3]),
              ),
            ),
          ) *
            180) /
          Math.PI,
      ),
    );
    below10 += Number(angle < 10);
    minAngle = Math.min(minAngle, angle);
  }
  return {
    vertices: points.length,
    hull: hull.length,
    interior: points.length - hull.length,
    triangles: triangles.length / 3,
    foreground,
    missed,
    added,
    missedFraction: missed / foreground,
    addedFraction: added / foreground,
    alphaWeightedMissedFraction: weightedMissed / alphaTotal,
    minAngle,
    trianglesBelow10Degrees: below10,
  };
}

function symmetricNearestDistance(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0 || b.length === 0) return null;
  const oneWay = (source, target) =>
    source.reduce(
      (sum, point) =>
        sum +
        Math.min(...target.map((other) => Math.hypot(point[0] - other[0], point[1] - other[1]))),
      0,
    ) / source.length;
  return (oneWay(a, b) + oneWay(b, a)) / 2;
}

const [configPath, destination] = process.argv.slice(2);
if (!configPath || !destination)
  throw new Error(
    "Usage: node tools/mesh-reference-check.mjs <private-config.json> <external-output-directory>",
  );
const config = JSON.parse(await readFile(configPath, "utf8"));
const runs = config.runs ?? 100;
if (!Number.isInteger(runs) || runs < 1) throw new Error("runs must be a positive integer");
const out = resolve(destination);
await mkdir(out, { recursive: true });
const repository = await realpath(fileURLToPath(new URL("../", import.meta.url)));
const relativeOutput = relative(repository, await realpath(out));
if (
  !isAbsolute(relativeOutput) &&
  relativeOutput !== ".." &&
  !relativeOutput.startsWith("..\\") &&
  !relativeOutput.startsWith("../")
)
  throw new Error("Private reference outputs must be outside the repository");
const results = [];
for (const entry of config.cases) {
  if (!/^[a-z0-9-]+$/.test(entry.id))
    throw new Error("Case id must be lowercase letters, digits or hyphens");
  const bytes = await readFile(entry.png);
  const png = PNG.sync.read(bytes);
  const { width, height } = png;
  const alpha = Uint8Array.from({ length: width * height }, (_, i) => png.data[i * 4 + 3]);
  const prepared = prepareAlphaForMesh(alpha, width, height, config.cleanupFraction ?? 0.005);
  const part = {
    id: entry.id,
    name: entry.id,
    sourcePath: "private.png",
    drawOrder: 0,
    bounds: { x: 0, y: 0, width, height },
    alphaMask: encodeAlphaMask(width, height, alpha),
  };
  let artist = null;
  let artistGeometry = null;
  if (entry.skeleton) {
    const document = JSON.parse(await readFile(entry.skeleton, "utf8"));
    const attachment = document.skins.find((s) => s.name === (entry.skin ?? "default"))
      ?.attachments[entry.slot]?.[entry.attachment];
    if (!attachment || attachment.type !== "mesh")
      throw new Error(`Missing mesh reference: ${entry.id}`);
    if (attachment.width !== width || attachment.height !== height)
      throw new Error(`PNG/reference size mismatch: ${entry.id}`);
    const points = Array.from({ length: attachment.uvs.length / 2 }, (_, i) => [
      attachment.uvs[i * 2] * width,
      attachment.uvs[i * 2 + 1] * height,
    ]);
    const hull = Array.from({ length: attachment.hull }, (_, i) => i);
    const edgeClasses = classifySpineMeshEdges(attachment);
    artistGeometry = { vertices: points, hull, triangles: attachment.triangles, ...edgeClasses };
    artist = {
      spineVersion: document.skeleton.spine,
      ...metrics(points, hull, attachment.triangles, prepared.alpha, width, height),
      manualEdges: edgeClasses.manualEdges.length,
      automaticTriangleEdges: edgeClasses.automaticTriangleEdges.length,
    };
  }
  const referenceTopology =
    artist && artistGeometry
      ? {
          vertices: artist.vertices,
          hull: artist.hull,
          bands:
            artist.interior % 2 === 0
              ? Array.from({ length: artist.interior / 2 }, (_, i) => {
                  const pair = artistGeometry.vertices
                    .slice(artist.hull)
                    .sort((a, b) => a[1] - b[1])
                    .slice(i * 2, i * 2 + 2);
                  const y = Math.max(
                    0,
                    Math.min(height - 1, Math.floor((pair[0][1] + pair[1][1]) / 2)),
                  );
                  const filled = Array.from({ length: width }, (_, x) => x).filter(
                    (x) => prepared.alpha[y * width + x] > 0,
                  );
                  return {
                    position: (y + 0.5) / height,
                    widthFraction: Math.min(
                      0.99,
                      Math.abs(pair[1][0] - pair[0][0]) /
                        (filled[filled.length - 1] - filled[0] + 1),
                    ),
                  };
                })
              : undefined,
        }
      : undefined;
  const options = artist ? { ...entry.options, referenceTopology } : entry.options;
  const { mesh, diagnostics } = generateMeshWithDiagnostics(part, prepared.alpha, options);
  const serialization = JSON.stringify(mesh);
  for (let run = 1; run < runs; run++) {
    if (JSON.stringify(generateMesh(part, prepared.alpha, options)) !== serialization)
      throw new Error(`Non-deterministic case: ${entry.id}`);
  }
  if (artistGeometry) {
    await writeFile(join(out, `${entry.id}.artist.json`), JSON.stringify(artistGeometry), {
      flag: "wx",
    });
    await writeFile(join(out, `${entry.id}.profile.json`), JSON.stringify(referenceTopology), {
      flag: "wx",
    });
  }
  await writeFile(join(out, `${entry.id}.mesh.json`), serialization, { flag: "wx" });
  const result = {
    id: entry.id,
    pngSha256: createHash("sha256").update(bytes).digest("hex"),
    width,
    height,
    options: options ?? {},
    cleanup: {
      componentCount: prepared.componentCount,
      discardedPixels: prepared.discardedPixels,
      pinchFilledPixels: prepared.pinchFilledPixels,
      holeFilledPixels: prepared.holeFilledPixels,
      holeCount: prepared.holeCount,
    },
    artist,
    generated: metrics(mesh.vertices, mesh.hull, mesh.triangles, prepared.alpha, width, height),
    validation: validateMeshSpec(mesh),
    diagnostics,
    referenceComparison: artistGeometry
      ? {
          hullNearestDistancePixels: symmetricNearestDistance(
            artistGeometry.vertices.slice(0, artistGeometry.hull.length),
            mesh.vertices.slice(0, mesh.hull.length),
          ),
          interiorNearestDistancePixels: symmetricNearestDistance(
            artistGeometry.vertices.slice(artistGeometry.hull.length),
            mesh.vertices.slice(mesh.hull.length),
          ),
          topology: compareArtistTopology({
            id: entry.id,
            artist: artistGeometry,
            generated: mesh,
            width,
            height,
          }),
        }
      : null,
    deterministicRuns: runs,
  };
  results.push(result);
  console.log(JSON.stringify(result));
}
await writeFile(join(out, "report.json"), JSON.stringify(results, null, 2), { flag: "wx" });
if (
  results.some(
    (result) =>
      result.referenceComparison && result.referenceComparison.topology.status !== "PASSED",
  )
)
  process.exitCode = 2;
