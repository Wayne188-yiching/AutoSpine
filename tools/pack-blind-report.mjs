// Pack the blind test report with every local file it references (videos included)
// into one folder + ZIP, so it opens on another computer by double-clicking the HTML.
// Output goes to docs/local-reviews/ (git-ignored): it contains artist videos.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import process from "node:process";
import console from "node:console";

const report = resolve(process.argv[2] ?? "docs/reports/blind-tests/autospine-blind-report.html");
const root = dirname(report);
const name = "autospine-blind-report-portable";
const out = resolve("docs/local-reviews", name);
const zip = out + ".zip";

const files = new Set();
const missing = [];
const visit = (file) => {
  const rel = relative(root, file);
  if (rel.startsWith("..")) throw new Error(`Reference leaves the report folder: ${rel}`);
  if (files.has(rel)) return;
  if (!existsSync(file)) return missing.push(rel.replaceAll("\\", "/"));
  files.add(rel);
  if (extname(file) !== ".html") return;
  for (const [, ref] of readFileSync(file, "utf8").matchAll(/\b(?:src|href|poster)="([^"]+)"/g)) {
    if (/^(?:#|[a-z][a-z0-9+.-]*:)/i.test(ref)) continue;
    visit(resolve(dirname(file), decodeURIComponent(ref.replace(/[?#].*$/, ""))));
  }
};
visit(report);

rmSync(out, { recursive: true, force: true });
rmSync(zip, { force: true });
let bytes = 0;
for (const rel of files) {
  cpSync(join(root, rel), join(out, rel));
  bytes += statSync(join(root, rel)).size;
}

const zipped =
  process.platform === "win32"
    ? spawnSync(join(process.env.SystemRoot, "System32", "tar.exe"), [
        "-a",
        "-cf",
        zip,
        "-C",
        out,
        ...readdirSync(out),
      ])
    : spawnSync("zip", ["-qr", zip, ...readdirSync(out)], { cwd: out });
if (zipped.status !== 0) throw new Error(`ZIP failed: ${zipped.stderr}`);

console.log(`${files.size} files, ${(bytes / 2 ** 20).toFixed(1)} MiB -> ${relative(".", zip)}`);
if (missing.length) console.log(`Missing (linked but not on disk):\n  ${missing.join("\n  ")}`);
