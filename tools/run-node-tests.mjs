import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";

const files = readdirSync("tests")
  .filter(
    (name) =>
      name.endsWith(".test.mjs") &&
      /from ["']node:test["']/.test(readFileSync(`tests/${name}`, "utf8")),
  )
  .map((name) => `tests/${name}`);
if (files.length) {
  const result = spawnSync(process.execPath, ["--test", "--test-concurrency=4", ...files], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
