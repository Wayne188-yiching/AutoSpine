import { defineConfig } from "vitest/config";
import { readdirSync, readFileSync } from "node:fs";

// Existing portable diagnostics use two runners; route without rewriting them.
const nodeTests = readdirSync("tests")
  .filter(
    (name) =>
      name.endsWith(".test.mjs") &&
      /from ["']node:test["']/.test(readFileSync(`tests/${name}`, "utf8")),
  )
  .map((name) => `tests/${name}`);

export default defineConfig({
  test: { include: ["tests/**/*.test.{ts,mjs}"], exclude: nodeTests, maxWorkers: 4 },
});
