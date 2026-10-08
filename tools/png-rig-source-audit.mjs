// Reference-side inventory only. Manual identities never enter the PNG worker's feature input.
import { readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, relative, isAbsolute, join } from "node:path";
import process from "node:process";
import console from "node:console";
import { attachmentEntries } from "./reference-topology.mjs";
import { runPngEvidence } from "./png-rig-evidence.mjs";

const hashFile = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const [configPath, destination, ...extra] = process.argv.slice(2);
if (!configPath || !destination || extra.length)
  throw new Error("Usage: node tools/png-rig-source-audit.mjs sources.json NEW_report.json");
const sources = JSON.parse(readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
if (!Array.isArray(sources) || !sources.length) throw new Error("Source array required");
const evidenceByHash = new Map();
const projects = [],
  cases = [];
for (const source of sources) {
  if (!source.id || source.exportExit !== 0 || hashFile(source.source) !== source.sourceSha256)
    throw new Error("Export source provenance mismatch");
  const exports = readdirSync(source.exportDirectory).filter((name) => name.endsWith(".json"));
  if (exports.length !== 1) throw new Error("Explicit single-skeleton export required");
  const exportPath = join(source.exportDirectory, exports[0]);
  const document = JSON.parse(readFileSync(exportPath, "utf8"));
  const entries = attachmentEntries(document).filter((entry) => entry.attachment.type === "mesh");
  const images = realpathSync(source.images);
  projects.push({
    id: source.id,
    sourceSha256: source.sourceSha256,
    exportSha256: hashFile(exportPath),
    exportVersion: document.skeleton?.spine ?? null,
    meshCount: entries.length,
    sourceUnchanged: true,
  });
  for (const { skin, slot, name, attachment } of entries) {
    const record = {
      id: `${source.id}/${skin}/${slot}/${name}`,
      project: source.id,
      skin,
      slot,
      attachment: name,
    };
    cases.push(record);
    try {
      const pngPath = realpathSync(resolve(images, `${attachment.path ?? name}.png`));
      const local = relative(images, pngPath);
      if (
        isAbsolute(local) ||
        local === ".." ||
        local.startsWith("..\\") ||
        local.startsWith("../")
      )
        throw new Error("Image outside authorized source root");
      const pngSha256 = hashFile(pngPath);
      record.pngPath = pngPath;
      record.pngSha256 = pngSha256;
      if (!evidenceByHash.has(pngSha256)) {
        const evidence = runPngEvidence(pngPath);
        if (evidence.pngSha256 !== pngSha256 || hashFile(pngPath) !== pngSha256)
          throw new Error("PNG changed during analysis");
        evidenceByHash.set(pngSha256, evidence);
      }
      const evidence = evidenceByHash.get(pngSha256);
      record.imageEvidenceId = pngSha256;
      record.dimensionMatch =
        attachment.width === evidence.width && attachment.height === evidence.height;
      record.status = record.dimensionMatch ? "PIXEL_EVIDENCE_ONLY" : "SOURCE_DIMENSION_MISMATCH";
    } catch (error) {
      record.status = "SOURCE_BLOCKED";
      record.reason = error.message;
    }
  }
  if (hashFile(source.source) !== source.sourceSha256)
    throw new Error("Source changed during audit");
}
const evidence = [...evidenceByHash.values()];
const report = {
  date: "2026-10-05",
  phase: "PNG-only source and region evidence, not object recognition or rig acceptance",
  projects,
  cases,
  evidence,
  summary: {
    meshCases: cases.length,
    uniquePngsAnalyzed: evidence.length,
    sourceBlocked: cases.filter((c) => c.status !== "PIXEL_EVIDENCE_ONLY").length,
    oneRegionImages: evidence.filter((e) => e.regions.length === 1).length,
    multipleRegionImages: evidence.filter((e) => e.regions.length > 1).length,
    emptyImages: evidence.filter((e) => !e.foregroundPixels).length,
  },
  carryover23: {
    status: "MISSING_FROZEN_IDENTITY_LIST",
    required: 23,
    originalDistribution: { yuuna: 14, panda: 4, pig: 5 },
    identified: null,
    rigsGenerated: 0,
    qualityAccepted: 0,
    note: "Do not replace the original 23 by a newly selected subset of this inventory.",
  },
  liveModelUsed: false,
  manualGeometrySentToWorker: false,
  sourceModified: false,
};
writeFileSync(destination, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(
  JSON.stringify({ projects, summary: report.summary, carryover23: report.carryover23 }, null, 2),
);
