#!/usr/bin/env node
// Offline catalogue validation/search/rendering. Research is done by the scheduled operator.
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { renderAnimationIndex } from "./animation-library-view.mjs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import console from "node:console";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const library = join(root, "knowledge", "animation");
const nonblank = (value) => typeof value === "string" && value.trim().length > 0;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const list = (value) => Array.isArray(value) && value.every(nonblank);
const timestamp = (value) =>
  nonblank(value) &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) &&
  Number.isFinite(Date.parse(value));
const statuses = [
  "metadata-only",
  "text-reviewed",
  "image-reviewed",
  "visual-samples",
  "clip-reviewed",
];

export function canonicalizeSourceUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Source must be a public HTTPS URL without credentials");
  const host = url.hostname.toLowerCase();
  if (
    ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"].includes(host)
  ) {
    const parts = url.pathname.split("/").filter(Boolean);
    const id = host.endsWith("youtu.be")
      ? parts[0]
      : ["shorts", "embed"].includes(parts[0])
        ? parts[1]
        : url.searchParams.get("v");
    if (!/^[\w-]{11}$/.test(id ?? "")) throw new Error("YouTube source needs a video ID");
    return `https://www.youtube.com/watch?v=${id}`;
  }
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (/^utm_/i.test(key) || ["fbclid", "gclid"].includes(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}

export function validateCatalog(data) {
  const errors = [];
  if (
    !object(data) ||
    data.schemaVersion !== 1 ||
    !Array.isArray(data.entries) ||
    !object(data.taxonomy)
  )
    return ["Invalid catalogue root or schemaVersion"];
  if (!timestamp(data.updatedAt)) errors.push("updatedAt needs an ISO timestamp with timezone");
  for (const group of ["regions", "mediums", "stages", "techniques", "statuses"])
    if (!object(data.taxonomy[group]) || !Object.values(data.taxonomy[group]).every(nonblank))
      errors.push(`Invalid taxonomy: ${group}`);
  for (const group of ["actions", "forms"])
    if (
      data.taxonomy[group] !== undefined &&
      (!object(data.taxonomy[group]) || !Object.values(data.taxonomy[group]).every(nonblank))
    )
      errors.push(`Invalid taxonomy: ${group}`);
  const ids = new Set(),
    sources = new Map(),
    imageSources = new Map();
  for (const [index, entry] of data.entries.entries()) {
    const label = object(entry) && nonblank(entry.id) ? entry.id : `entry[${index}]`;
    const require = (condition, message) => {
      if (!condition) errors.push(`${label}: ${message}`);
    };
    if (!object(entry)) {
      errors.push(`${label}: expected object`);
      continue;
    }
    require(nonblank(entry.id) &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id) &&
      !ids.has(entry.id), "invalid or duplicate id");
    ids.add(entry.id);
    for (const key of ["title", "work"]) require(nonblank(entry[key]), `${key} required`);
    for (const [field, group] of [
      ["region", "regions"],
      ["medium", "mediums"],
    ])
      require(Object.hasOwn(data.taxonomy[group] ?? {}, entry[field]), `unknown ${field}`);
    for (const [field, group] of [
      ["stages", "stages"],
      ["techniques", "techniques"],
    ])
      require(list(entry[field]) &&
        new Set(entry[field]).size === entry[field].length &&
        entry[field].every((tag) =>
          Object.hasOwn(data.taxonomy[group] ?? {}, tag),
        ), `invalid ${field}`);
    for (const field of ["actions", "forms"])
      if (entry[field] !== undefined)
        require(list(entry[field]) &&
          new Set(entry[field]).size === entry[field].length &&
          entry[field].every((tag) =>
            Object.hasOwn(data.taxonomy[field] ?? {}, tag),
          ), `invalid ${field}`);
    require(timestamp(entry.firstSeen) &&
      timestamp(entry.lastVerified) &&
      Date.parse(entry.firstSeen) <= Date.parse(entry.lastVerified), "invalid verification dates");
    const source = entry.source;
    if (!object(source)) {
      errors.push(`${label}: source required`);
      continue;
    }
    for (const key of ["url", "publisher", "platform", "verification"])
      require(nonblank(source[key]), `source.${key} required`);
    require(typeof source.official === "boolean", "source.official must be boolean");
    if (source.kind !== undefined)
      require(["video", "image", "document"].includes(source.kind), "invalid source.kind");
    if (source.kind === "image") {
      require(nonblank(source.imageUrl) &&
        nonblank(source.imageAlt) &&
        nonblank(source.creator) &&
        nonblank(
          source.rights,
        ), "images require preview URL, description, creator and rights notes");
      try {
        const preview = new URL(canonicalizeSourceUrl(source.imageUrl));
        if (preview.hostname === "i.pinimg.com")
          preview.pathname = preview.pathname.replace(/^\/(?:\d+x|originals)\//, "/originals/");
        const previous = imageSources.get(preview.href);
        require(!previous || previous === entry.id, `duplicate image of ${previous}`);
        imageSources.set(preview.href, entry.id);
      } catch {
        require(false, "invalid image preview URL");
      }
      require(entry.forms?.length > 0 &&
        entry.actions?.length > 0, "images require form and action classification");
    }
    require(list(source.aliases), "source.aliases must be an array of URLs");
    if (source.durationSeconds !== undefined)
      require(Number.isFinite(source.durationSeconds) &&
        source.durationSeconds > 0, "invalid duration");
    const localUrls = new Set();
    for (const raw of [source.url, ...(Array.isArray(source.aliases) ? source.aliases : [])]) {
      try {
        const key = canonicalizeSourceUrl(raw);
        const previous = sources.get(key);
        require(!previous || previous === entry.id, `duplicate source of ${previous}`);
        // Alternate YouTube spellings in one entry are allowed and collapse to one identity.
        localUrls.add(key);
      } catch {
        require(false, `invalid source URL: ${String(raw)}`);
      }
    }
    for (const key of localUrls) sources.set(key, entry.id);
    for (const field of ["observations", "application", "limits"])
      require(list(entry[field]), `${field} must be an array of nonblank notes`);
    require(Array.isArray(entry.limits) && entry.limits.length > 0, "limits required");
    const review = entry.review;
    if (!object(review)) {
      errors.push(`${label}: review required`);
      continue;
    }
    require(statuses.includes(review.status), "unknown review status");
    require(nonblank(review.method) &&
      nonblank(review.locator), "review method and locator required");
    require(["none", "continuous-video", "explicit-text"].includes(
      review.timingBasis,
    ), "invalid timingBasis");
    const samples = Array.isArray(review.samples) ? review.samples : [];
    const segments = Array.isArray(review.segments) ? review.segments : [];
    require(Array.isArray(review.samples) &&
      Array.isArray(review.segments), "samples/segments must be arrays");
    for (const sample of samples)
      require(object(sample) &&
        Number.isFinite(sample.seconds) &&
        sample.seconds >= 0 &&
        (source.durationSeconds === undefined || sample.seconds <= source.durationSeconds) &&
        nonblank(sample.note), "invalid sampled frame");
    for (const segment of segments)
      require(object(segment) &&
        Number.isFinite(segment.start) &&
        Number.isFinite(segment.end) &&
        segment.start >= 0 &&
        segment.end > segment.start &&
        (source.durationSeconds === undefined || segment.end <= source.durationSeconds) &&
        nonblank(segment.note), "invalid watched segment");
    if (review.status === "metadata-only") {
      require(samples.length === 0 &&
        segments.length === 0 &&
        entry.observations?.length === 0 &&
        entry.application?.length ===
          0, "metadata-only cannot claim observed technique or application");
      require(review.timingBasis === "none", "metadata-only cannot claim timing evidence");
    } else {
      require(entry.observations?.length > 0 &&
        entry.application?.length > 0 &&
        entry.stages?.length > 0 &&
        entry.techniques?.length >
          0, "reviewed entries need observations, application and classification");
    }
    if (review.status === "visual-samples")
      require(samples.length > 0 &&
        segments.length === 0 &&
        review.timingBasis ===
          "none", "sampled stills need samples and cannot claim continuous timing");
    if (review.status === "image-reviewed")
      require(source.kind === "image" &&
        samples.length === 0 &&
        segments.length === 0 &&
        review.timingBasis === "none", "image review cannot claim video timing or timestamps");
    if (source.kind === "image")
      require(["metadata-only", "image-reviewed"].includes(review.status) &&
        review.timingBasis === "none", "still images cannot claim video review or timing");
    if (review.status === "clip-reviewed")
      require(segments.length > 0, "clip-reviewed needs watched intervals");
    if (review.timingBasis === "continuous-video")
      require(review.status === "clip-reviewed" &&
        segments.length > 0, "continuous timing requires a watched clip");
    if (review.timingBasis === "explicit-text")
      require(review.status === "text-reviewed", "text timing requires text-reviewed evidence");
  }
  return errors;
}

export function searchEntries(data, query = "", includeQueue = false) {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return data.entries.filter((entry) => {
    if (!includeQueue && entry.review.status === "metadata-only") return false;
    const searchable = [
      entry.id,
      entry.title,
      entry.work,
      entry.region,
      entry.medium,
      entry.source.publisher,
      entry.source.platform,
      entry.review.status,
      ...entry.stages,
      ...entry.techniques,
      ...(entry.actions ?? []),
      ...(entry.forms ?? []),
      entry.source.kind ?? "",
      ...entry.observations,
      ...entry.application,
      ...entry.limits,
      entry.review.method,
      entry.review.locator,
      ...entry.review.samples.map((sample) => sample.note),
      ...entry.review.segments.map((segment) => segment.note),
      data.taxonomy.regions[entry.region],
      data.taxonomy.mediums[entry.medium],
      ...entry.techniques.map((tag) => data.taxonomy.techniques[tag]),
      ...entry.stages.map((tag) => data.taxonomy.stages[tag]),
      ...(entry.actions ?? []).map((tag) => data.taxonomy.actions?.[tag]),
      ...(entry.forms ?? []).map((tag) => data.taxonomy.forms?.[tag]),
    ].join(" ");
    return words.every((word) => searchable.toLocaleLowerCase().includes(word));
  });
}

export function renderIndex(data) {
  const errors = validateCatalog(data);
  if (errors.length) throw new Error(errors.join("\n"));
  return renderAnimationIndex(data);
}

export function createLibraryServer() {
  return createServer(async (request, response) => {
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }
    const path = request.url?.split("?")[0];
    if (!["/", "/index.html"].includes(path)) {
      response.writeHead(404);
      response.end();
      return;
    }
    try {
      const html = await readFile(join(library, "index.html"));
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      });
      response.end(request.method === "HEAD" ? undefined : html);
    } catch {
      response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("知識庫暫時無法讀取，請重新建立目錄。");
    }
  });
}

async function main() {
  const data = JSON.parse(await readFile(join(library, "catalog.json"), "utf8"));
  const errors = validateCatalog(data);
  if (errors.length) throw new Error(errors.join("\n"));
  const [command = "check", ...args] = process.argv.slice(2);
  if (command === "serve") {
    const port = Number(args[0] ?? 8767);
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error("Port must be 1024–65535");
    await writeFile(join(library, "index.html"), renderIndex(data));
    const server = createLibraryServer();
    await new Promise((ready, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", ready);
    });
    console.log(`Animation library: http://127.0.0.1:${port}/`);
  } else if (command === "build") {
    await writeFile(join(library, "index.html"), renderIndex(data));
    console.log(`Built animation reference index: ${data.entries.length} sources`);
  } else if (command === "check")
    console.log(`Animation catalogue valid: ${data.entries.length} sources`);
  else if (command === "search") {
    const entries = searchEntries(
      data,
      args.filter((arg) => arg !== "--all").join(" "),
      args.includes("--all"),
    );
    console.log(JSON.stringify(entries, null, 2));
  } else
    throw new Error(
      "Use: animation-knowledge.mjs check | build | search [terms] [--all] | serve [port]",
    );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
