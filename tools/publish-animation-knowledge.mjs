#!/usr/bin/env node
// Publish an allowlisted snapshot on top of origin/main without touching the working index or HEAD.
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import console from "node:console";
import { renderIndex } from "./animation-knowledge.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = "https://github.com/Wayne188-yiching/AutoSpine.git";
const libraryFiles = [
  "knowledge/animation/catalog.json",
  "knowledge/animation/index.html",
  "knowledge/animation/README.md",
  "knowledge/animation/CURATION.md",
];
const setupFiles = [
  "AGENTS.md",
  ".github/workflows/animation-knowledge-pages.yml",
  "tools/animation-knowledge.mjs",
  "tools/animation-library-view.mjs",
  "tools/publish-animation-knowledge.mjs",
  "tests/animation-knowledge.test.mjs",
  "tests/animation-knowledge-publish.test.mjs",
];

export async function publishAnimationKnowledge({
  root = projectRoot,
  expectedRemote = repository,
  bootstrap = false,
  dryRun = false,
} = {}) {
  const git = (args, options = {}) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      ...options,
    }).trim();
  if (git(["remote", "get-url", "origin"]) !== expectedRemote)
    throw new Error("Origin differs from the authorized knowledge repository");
  const catalogFile = join(root, libraryFiles[0]);
  const catalog = JSON.parse(await readFile(catalogFile, "utf8"));
  const index = renderIndex(catalog); // Validates evidence, classifications and source deduplication.
  await writeFile(join(root, libraryFiles[1]), index);
  git(["fetch", "origin", "main"]);
  const parent = git(["rev-parse", "refs/remotes/origin/main"]);
  const remoteCatalog = JSON.parse(git(["show", `${parent}:${libraryFiles[0]}`]));
  for (const remoteEntry of remoteCatalog.entries) {
    const local = catalog.entries.find((entry) => entry.id === remoteEntry.id);
    if (!local || Date.parse(remoteEntry.lastVerified) > Date.parse(local.lastVerified))
      throw new Error(`Remote reference ${remoteEntry.id} is missing or newer; reconcile it first`);
  }
  const runs = (await readdir(join(root, "knowledge/animation/runs")))
    .filter((file) => /^\d{4}-\d\d-\d\dT[\w-]+\.json$/.test(file))
    .sort()
    .map((file) => `knowledge/animation/runs/${file}`);
  const paths = [...libraryFiles, ...runs, ...(bootstrap ? setupFiles : [])];
  // A private temporary index makes staged production changes irrelevant to this commit.
  const scratch = await mkdtemp(join(tmpdir(), "autospine-publish-"));
  const env = { ...process.env, GIT_INDEX_FILE: join(scratch, "index") };
  try {
    git(["read-tree", parent], { env });
    for (const path of paths) {
      const contents = await readFile(join(root, path));
      if (path.endsWith(".json")) JSON.parse(contents.toString("utf8"));
      const blob = git(["hash-object", "-w", `--path=${path}`, "--stdin"], { input: contents });
      git(["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`], { env });
    }
    const tree = git(["write-tree"], { env });
    const changed = git(["diff-tree", "--no-commit-id", "--name-only", "-r", parent, tree])
      .split(/\r?\n/)
      .filter(Boolean);
    if (changed.some((path) => !paths.includes(path))) throw new Error("Unexpected publish path");
    if (dryRun) return { status: "dry-run", parent, changed };
    let commit = parent;
    if (changed.length) {
      commit = git([
        "commit-tree",
        tree,
        "-p",
        parent,
        "-m",
        bootstrap
          ? "Deploy the Spine animation knowledge site"
          : "Update animation reference knowledge",
      ]);
      // No force: a concurrent remote update is rejected rather than overwritten.
      git(["push", "origin", `${commit}:refs/heads/main`]);
    }
    const remoteHead = git(["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0];
    if (remoteHead !== commit)
      throw new Error("Remote advanced during verification; check sync status");
    const result = {
      status: changed.length ? "published" : "no-change",
      commit,
      changed,
      verifiedAt: new Date().toISOString(),
      site: "https://wayne188-yiching.github.io/AutoSpine/",
    };
    const receipt = resolve(
      root,
      git(["rev-parse", "--git-path", "autospine-animation-publish.json"]),
    );
    await writeFile(receipt, JSON.stringify(result, null, 2) + "\n");
    return result;
  } finally {
    await rm(join(scratch, "index"), { force: true });
    await rm(join(scratch, "index.lock"), { force: true });
    await rmdir(scratch);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => !["--bootstrap", "--dry-run"].includes(flag))) {
    console.error("Use: publish-animation-knowledge.mjs [--bootstrap] [--dry-run]");
    process.exitCode = 1;
  } else {
    publishAnimationKnowledge({
      bootstrap: flags.includes("--bootstrap"),
      dryRun: flags.includes("--dry-run"),
    })
      .then((result) => console.log(JSON.stringify(result, null, 2)))
      .catch((error) => {
        console.error(`Knowledge publication failed: ${error.message}`);
        process.exitCode = 1;
      });
  }
}
