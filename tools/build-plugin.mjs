#!/usr/bin/env node
// Generates the parts of plugin/skills/autospine that come from the repository:
//   scripts/    the engine as single files (CLI and MCP stdio server), with the Spine runtime
//   references/ the user guide, plan runbook, engine notes and ADRs, links rewritten for the plugin
//   assets/     the Spine command-line export settings and a runnable example (the synthetic test
//               character from tests/character-fixture.ts, no private art)
// SKILL.md, the manifests and the MCP configs are written by hand and are not touched.
//
// Usage (after `npm run build`):
//   node tools/build-plugin.mjs           write the files
//   node tools/build-plugin.mjs --check   regenerate into a temporary folder and compare; exit 1 on drift
import { build } from "esbuild";
import console from "node:console";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skill = join(root, "plugin", "skills", "autospine");
const repoUrl = "https://github.com/Wayne188-yiching/AutoSpine/blob/main/";
const check = process.argv.includes("--check");

/** Repository document → path inside the skill folder. */
const copies = new Map([
  ["docs/USER_GUIDE.md", "references/user-guide.md"],
  ["docs/CHARACTER_PLAN.md", "references/character-plan.md"],
  ["docs/MCP_ADAPTER.md", "references/mcp-tools.md"],
  ["docs/SPINE_APPLICATION_KNOWLEDGE.md", "references/spine-application-knowledge.md"],
  ["docs/SPINE_TUTORIAL_ENGINEERING_NOTES.md", "references/spine-tutorial-notes.md"],
  ["skills/autospine/references/production-workflow.md", "references/production-workflow.md"],
  ["skills/autospine/references/engine-pipeline.md", "references/engine-pipeline.md"],
  ["skills/autospine/references/existing-rig-motion.md", "references/existing-rig-motion.md"],
  ["skills/autospine/references/rig-deformation.md", "references/rig-deformation.md"],
  ["skills/autospine/references/controls-animation.md", "references/controls-animation.md"],
  ["skills/autospine/references/pose-first-workflow.md", "references/pose-first-workflow.md"],
  ["knowledge/animation/README.md", "references/animation-knowledge.md"],
  ["knowledge/animation/CURATION.md", "references/animation-curation.md"],
  ["knowledge/animation/catalog.json", "references/animation-catalog.json"],
  ["knowledge/animation/index.html", "references/animation-index.html"],
]);
for (const name of (await readdir(join(root, "docs", "adr"))).sort())
  if (name.endsWith(".md")) copies.set(`docs/adr/${name}`, `references/adr/${name}`);

const CLI_IN_REPO = /node packages\/cli\/dist\/index\.js/g;
const CLI_IN_SKILL = "node <skill>/scripts/autospine.mjs";

/** Rewrites Markdown links: copied documents point at their copies, everything else at GitHub. */
function rewrite(text, source, target) {
  const sourceDir = posix.dirname(source);
  const targetDir = posix.dirname(target);
  // A Windows checkout (core.autocrlf) reads CRLF; the copies are compared byte for byte.
  const linked = text.replace(/\r\n/g, "\n").replace(/\]\(([^)\s]+)\)/g, (whole, href) => {
    if (/^[a-z]+:/i.test(href) || href.startsWith("#")) return whole;
    const [path, anchor = ""] = href.split(/(?=#)/);
    const repoPath = posix.normalize(posix.join(sourceDir, path));
    const copied = copies.get(repoPath);
    const next = copied
      ? posix.relative(targetDir, copied) || posix.basename(copied)
      : repoUrl + repoPath;
    return `](${next}${anchor})`;
  });
  const header = `<!-- Generated from ${source} by tools/build-plugin.mjs. Edit the source, then rebuild. -->\n\n`;
  return header + linked.replace(CLI_IN_REPO, CLI_IN_SKILL);
}

async function generate(dest) {
  await rm(join(dest, "scripts"), { recursive: true, force: true });
  await rm(join(dest, "references"), { recursive: true, force: true });
  await rm(join(dest, "assets"), { recursive: true, force: true });
  await mkdir(join(dest, "scripts"), { recursive: true });
  const shared = {
    absWorkingDir: root,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    legalComments: "eof",
    logLevel: "warning",
    // CommonJS dependencies (pngjs) call require() for Node built-ins.
    banner: {
      js: 'import { createRequire as __autospineRequire } from "node:module";\nconst require = __autospineRequire(import.meta.url);',
    },
  };
  await build({
    ...shared,
    entryPoints: ["packages/cli/dist/index.js"],
    outfile: join(dest, "scripts", "autospine.mjs"),
  });
  await build({
    ...shared,
    entryPoints: ["packages/mcp/dist/stdio.js"],
    outfile: join(dest, "scripts", "autospine-mcp.mjs"),
  });
  // The official runtime is evaluated from its IIFE build (packages/reference/src/runtime.ts).
  const require = createRequire(join(root, "packages", "reference", "package.json"));
  const spine = dirname(require.resolve("@esotericsoftware/spine-core/package.json"));
  await writeFile(
    join(dest, "scripts", "spine-core.js"),
    await readFile(join(spine, "dist", "iife", "spine-core.js")),
  );
  for (const license of ["LICENSE", "LICENSE.md"]) {
    try {
      await writeFile(
        join(dest, "scripts", "spine-core.LICENSE"),
        await readFile(join(spine, license)),
      );
      break;
    } catch {
      /* try the next name */
    }
  }
  // Export settings for `Spine.com -e`: pretty JSON with nonessential data, no atlas packing.
  await mkdir(join(dest, "assets"), { recursive: true });
  await writeFile(
    join(dest, "assets", "spine-export-json.json"),
    await readFile(join(root, "tools", "spine-reference-export.json")),
  );
  // A runnable example: the synthetic test character (no private art), as plan + images-only input.
  const fixture = await build({
    absWorkingDir: root,
    entryPoints: ["tests/character-fixture.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    write: false,
    logLevel: "warning",
    banner: shared.banner,
  });
  const scratch = await mkdtemp(join(tmpdir(), "autospine-fixture-"));
  try {
    const module = join(scratch, "fixture.mjs");
    await writeFile(module, fixture.outputFiles[0].contents);
    const { fixtureWorkspace } = await import(pathToFileURL(module).href);
    const ws = await fixtureWorkspace();
    const example = join(dest, "assets", "example");
    await mkdir(join(example, "images"), { recursive: true });
    for (const name of ["plan.json", "imagesOnly.json"])
      await writeFile(
        join(example, name),
        JSON.stringify(JSON.parse(await readFile(join(ws, name), "utf8")), null, 2) + "\n",
      );
    for (const name of (await readdir(join(ws, "images"))).sort())
      await writeFile(join(example, "images", name), await readFile(join(ws, "images", name)));
    await rm(ws, { recursive: true, force: true });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  for (const [source, target] of copies) {
    const out = join(dest, target);
    await mkdir(dirname(out), { recursive: true });
    const contents = await readFile(join(root, source), "utf8");
    await writeFile(
      out,
      source.endsWith(".md") ? rewrite(contents, source, target) : contents.replace(/\r\n/g, "\n"),
    );
  }
}

async function list(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await list(full, base)));
    else out.push(relative(base, full).split("\\").join("/"));
  }
  return out.sort();
}

if (!check) {
  await generate(skill);
  console.log(`plugin skill regenerated: ${relative(root, skill)}`);
} else {
  const temp = await mkdtemp(join(tmpdir(), "autospine-plugin-"));
  try {
    await generate(temp);
    const problems = [];
    for (const part of ["scripts", "references", "assets"]) {
      const want = await list(join(temp, part));
      const have = await list(join(skill, part)).catch(() => []);
      for (const f of want.filter((f) => !have.includes(f))) problems.push(`missing ${part}/${f}`);
      for (const f of have.filter((f) => !want.includes(f))) problems.push(`extra ${part}/${f}`);
      for (const f of want.filter((f) => have.includes(f))) {
        const [a, b] = await Promise.all([
          readFile(join(temp, part, f)),
          readFile(join(skill, part, f)),
        ]);
        if (!a.equals(b)) problems.push(`stale ${part}/${f}`);
      }
    }
    if (problems.length) {
      console.error(
        `plugin skill is out of date (run npm run build && node tools/build-plugin.mjs):\n  ${problems.join("\n  ")}`,
      );
      process.exitCode = 1;
    } else console.log("plugin skill is up to date");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
