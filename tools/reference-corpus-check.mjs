// Local-only reference audit. Usage: node tools/reference-corpus-check.mjs config.json NEW_OUTPUT_DIR
import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute, join, basename } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { createHash } from "node:crypto";
import process from "node:process";
import console from "node:console";
import { PNG } from "pngjs";
import { encodeAlphaMask } from "@autospine/assets";
import {
  generateMeshWithDiagnostics,
  prepareAlphaForMesh,
  referenceRectangleFits,
} from "@autospine/mesh";
import {
  attachmentEntries,
  readArtistMesh,
  compareVertexPositions,
  compareTypedEdges,
  measureRasterCoverage,
  compareArtistCoverage,
  selectArtistForeground,
} from "./reference-topology.mjs";
import { checkArtistVertexCounts } from "./artist-vertex-policy.mjs";
import { referenceStructureFamily } from "./reference-structure.mjs";

const hash = (data) => createHash("sha256").update(data).digest("hex");
const [configPath, destination] = process.argv.slice(2);
if (!configPath || !destination)
  throw new Error("Expected config.json and a NEW external output directory");
const config = JSON.parse(await readFile(configPath, "utf8"));
if (
  config.referenceStructureFamilies !== undefined &&
  typeof config.referenceStructureFamilies !== "boolean"
)
  throw new Error("referenceStructureFamilies must be an explicit boolean");
const runs = config.runs ?? 2;
if (config.boundaryDecimation !== undefined && typeof config.boundaryDecimation !== "boolean")
  throw new Error("boundaryDecimation must be an explicit boolean");
if (config.boundaryDecimation && !config.rasterRegionConstraints)
  throw new Error("boundaryDecimation requires rasterRegionConstraints");
if (
  config.rasterRegionConstraints !== undefined &&
  typeof config.rasterRegionConstraints !== "boolean"
)
  throw new Error("rasterRegionConstraints must be an explicit boolean");
if (!Number.isInteger(runs) || runs < 1 || runs > 100) throw new Error("runs must be 1..100");
const acceptedRuns = config.acceptedRuns ?? runs;
if (!Number.isInteger(acceptedRuns) || acceptedRuns < runs || acceptedRuns > 100)
  throw new Error("acceptedRuns must be at least runs and at most 100");
const repository = await realpath(fileURLToPath(new URL("../", import.meta.url)));
const parent = await realpath(resolve(destination, ".."));
const candidate = join(parent, basename(resolve(destination)));
const local = relative(repository, candidate);
if (
  !isAbsolute(local) &&
  local !== ".." &&
  !local.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
)
  throw new Error("Private evidence must stay outside the repository");
await mkdir(candidate); // Refuse overwrite/reuse, including preexisting junctions.
const report = {
  policyVersion: "artist-region-typed-paths-5-v5",
  generatedAt: new Date().toISOString(),
  runs,
  acceptedRuns,
  projects: [],
  cases: [],
  jev: "NOT_SUBMITTED",
  phase: "baseline measurement; no artwork approval",
  referenceStructureFamilies: config.referenceStructureFamilies === true,
  rasterRegionConstraints: config.rasterRegionConstraints === true,
  boundaryDecimation: config.boundaryDecimation === true,
  configSha256: hash(await readFile(configPath)),
};
report.tutorialEvidence = [];
for (const observation of config.tutorialEvidence ?? []) {
  const frame = await readFile(observation.frame);
  report.tutorialEvidence.push({
    videoSha256: hash(await readFile(observation.video)),
    frameSha256: hash(frame),
    timeSeconds: observation.timeSeconds,
    observation: observation.observation,
    frame: `data:image/png;base64,${frame.toString("base64")}`,
    scope: "Single-frame visual observation; not a complete video or audio review",
  });
}
for (const project of config.projects) {
  const bytes = await readFile(project.export),
    document = JSON.parse(bytes.toString("utf8"));
  const sourceHash = hash(await readFile(project.source));
  const entries = attachmentEntries(document);
  report.projects.push({
    id: project.id,
    sourceSha256: sourceHash,
    exportSha256: hash(bytes),
    version: document.skeleton?.spine ?? null,
    freshExport: project.freshExport === true,
    requiredMeshIds: entries
      .filter((x) => x.attachment.type === "mesh")
      .map((x) => `${project.id}/${x.skin}/${x.slot}/${x.name}`),
    bones: document.bones?.length ?? 0,
    slots: document.slots?.length ?? 0,
    attachments: entries.length,
    meshes: entries.filter((x) => x.attachment.type === "mesh").length,
    regions: entries.filter((x) => !x.attachment.type || x.attachment.type === "region").length,
  });
  for (const entry of entries) {
    const { skin, slot, name, attachment } = entry;
    const id = `${project.id}/${skin}/${slot}/${name}`;
    const record = {
      id,
      project: project.id,
      skin,
      slot,
      attachment: name,
      sourceType: attachment.type ?? "region",
      sourceSha256: sourceHash,
      exportSha256: hash(bytes),
      freshExport: project.freshExport === true,
    };
    report.cases.push(record);
    if (record.sourceType !== "mesh") {
      record.status = "NOT_APPLICABLE";
      continue;
    }
    try {
      const root = await realpath(project.images);
      const pngPath = await realpath(resolve(root, `${attachment.path ?? name}.png`));
      const subpath = relative(root, pngPath);
      if (isAbsolute(subpath) || subpath.startsWith("..")) throw new Error("IMAGE_OUTSIDE_ROOT");
      const pngBytes = await readFile(pngPath),
        png = PNG.sync.read(pngBytes);
      const { width, height } = png;
      record.pngSha256 = hash(pngBytes);
      record.width = width;
      record.height = height;
      record.image = `data:image/png;base64,${pngBytes.toString("base64")}`;
      record.pngPath = pngPath;
      record.exportDimensions = [attachment.width ?? null, attachment.height ?? null];
      record.dimensionMatch = attachment.width === width && attachment.height === height;
      record.artist = readArtistMesh(attachment, width, height, document.skeleton?.spine);
      record.weighted = attachment.vertices.length !== attachment.uvs.length;
      record.deformAnimations = Object.entries(document.animations ?? {})
        .filter(([, animation]) => (animation.deform ?? animation.ffd)?.[skin]?.[slot]?.[name])
        .map(([animation]) => animation);
      const alpha = Uint8Array.from({ length: width * height }, (_, i) => png.data[i * 4 + 3]);
      if (!record.freshExport || !record.dimensionMatch)
        throw new Error("ARTIST_PADDING_SOURCE_UNVERIFIED");
      const { alpha: targetAlpha, ...region } = selectArtistForeground(
        record.artist,
        alpha,
        width,
        height,
      );
      record.referenceRegion = { mode: "artist-hull-pixel-centres", ...region };
      record.artistCoverage = measureRasterCoverage(record.artist, targetAlpha, width, height);
      const rectangle = referenceRectangleFits(targetAlpha, width, height, {
        vertices: record.artist.vertices.length,
        hull: record.artist.hull.length,
        maxAddedFraction: record.artistCoverage.addedFraction,
      });
      const prepared = rectangle
        ? {
            alpha: targetAlpha,
            mode: "reference-rectangle-no-cleanup",
            componentCount: null,
            holeCount: null,
            discardedPixels: 0,
            pinchFilledPixels: 0,
            holeFilledPixels: 0,
          }
        : prepareAlphaForMesh(targetAlpha, width, height, 0.005);
      const { alpha: preparedAlpha, ...cleanup } = prepared;
      record.cleanup = cleanup;
      const part = {
        id: "reference-part",
        name: "Reference part",
        sourcePath: "private.png",
        drawOrder: 0,
        bounds: { x: 0, y: 0, width, height },
        alphaMask: encodeAlphaMask(width, height, targetAlpha),
      };
      // Opt-in coarse family conditioning, not runtime reference XY/connectivity copying.
      const family = config.referenceStructureFamilies
        ? referenceStructureFamily(record.artist, width, height)
        : undefined;
      record.referenceStructure = family
        ? {
            family,
            selection: "reference graph coarse family; no XY or index graph supplied to generation",
          }
        : null;
      const options = {
        intent: "unknown",
        ...(config.boundaryDecimation ? { boundaryDecimation: true } : {}),
        ...(config.rasterRegionConstraints
          ? { rasterRegion: { sourceAlpha: alpha, targetAlpha } }
          : {}),
        referenceTopology: {
          vertices: record.artist.vertices.length,
          hull: record.artist.hull.length,
          maxAddedFraction: record.artistCoverage.addedFraction,
          ...(family ? { family } : {}),
        },
      };
      const { mesh, diagnostics } = generateMeshWithDiagnostics(part, preparedAlpha, options);
      record.generated = mesh;
      record.diagnostics = diagnostics;
      record.coverage = compareArtistCoverage(record.artist, mesh, alpha, width, height, true);
      record.count = checkArtistVertexCounts([
        {
          id,
          artistVertices: record.artist.vertices.length,
          generatedVertices: mesh.vertices.length,
        },
      ]).cases[0];
      record.positions = compareVertexPositions(record.artist, mesh, width, height);
      record.typedEdges = compareTypedEdges(record.artist, mesh, record.positions.pairs);
      record.edges = record.typedEdges.manual ?? record.typedEdges;
      const staticPassed =
        record.count.status === "PASSED" &&
        record.coverage.status === "PASSED" &&
        record.positions.passed &&
        record.typedEdges.status === "PASSED";
      const serialization = JSON.stringify(mesh);
      record.deterministicRuns = 1;
      for (let i = 1; i < (staticPassed ? acceptedRuns : runs); i++) {
        if (
          JSON.stringify(generateMeshWithDiagnostics(part, preparedAlpha, options).mesh) !==
          serialization
        )
          throw new Error("NONDETERMINISTIC");
        record.deterministicRuns++;
      }
      record.status =
        !record.freshExport || !record.dimensionMatch || record.typedEdges.status === "BLOCKED"
          ? "BLOCKED"
          : record.count.status !== "PASSED" ||
              record.coverage.status !== "PASSED" ||
              !record.positions.passed ||
              record.typedEdges.status !== "PASSED"
            ? "REJECTED"
            : "STATIC_CHECKS_PASSED";
    } catch (error) {
      record.status = "BLOCKED";
      record.error =
        error.validation?.issues
          ?.map((i) => `${i.code}: ${i.message ?? i.reason ?? ""}`)
          .join("; ") || error.message;
    }
    console.log(
      JSON.stringify({
        id,
        status: record.status,
        artist: record.artist?.vertices.length,
        generated: record.generated?.vertices.length,
        error: record.error,
      }),
    );
  }
  if (hash(await readFile(project.source)) !== sourceHash)
    throw new Error("SOURCE_CHANGED_DURING_AUDIT");
}
report.summary = {
  meshCases: report.cases.filter((x) => x.sourceType === "mesh").length,
  generated: report.cases.filter((x) => x.generated).length,
  countPassed: report.cases.filter((x) => x.count?.status === "PASSED").length,
  positionsPassed: report.cases.filter((x) => x.positions?.passed).length,
  coveragePassed: report.cases.filter((x) => x.coverage?.status === "PASSED").length,
  staticChecksPassed: report.cases.filter((x) => x.status === "STATIC_CHECKS_PASSED").length,
  blocked: report.cases.filter((x) => x.status === "BLOCKED").length,
  rejected: report.cases.filter((x) => x.status === "REJECTED").length,
};
await writeFile(join(candidate, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify(report.summary));
