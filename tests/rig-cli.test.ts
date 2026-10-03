import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const folder = mkdtempSync(join(tmpdir(), "autospine-rig-cli-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));
const cli = resolve("packages/cli/dist/index.js");
const run = (...args: string[]) => {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  if (result.error) throw result.error;
  return result;
};

describe("Gate 4 rig-chain CLI", () => {
  it("writes the generated rig, preserving input and refusing overwrite", () => {
    const input = join(folder, "chain-input.json");
    const output = join(folder, "chain-rig.json");
    const source = JSON.stringify({
      id: "tail",
      name: "Tail",
      start: [10, 20],
      end: [10, 80],
      boneCount: 3,
    });
    writeFileSync(input, source);
    const result = run("rig-chain", input, output);
    expect(result.status, result.stderr).toBe(0);
    const rig = JSON.parse(readFileSync(output, "utf8"));
    expect(rig.bones).toHaveLength(3);
    expect(rig.bones[1]).toMatchObject({ parentId: "tail-bone-1", x: 20, y: 0 });
    const saved = readFileSync(output);
    expect(run("rig-chain", input, output).status).toBe(1);
    expect(readFileSync(output)).toEqual(saved);
    expect(readFileSync(input, "utf8")).toBe(source);
    expect(run("rig-chain", input, input).status).toBe(1);
  });

  it("emits a structured rig-stage error and writes no output for degenerate input", () => {
    const input = join(folder, "bad-chain.json");
    const output = join(folder, "bad-rig.json");
    writeFileSync(
      input,
      JSON.stringify({ id: "tail", name: "Tail", start: [0, 0], end: [0, 0], boneCount: 2 }),
    );
    const result = run("rig-chain", input, output);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr).issues[0]).toMatchObject({
      code: "RIG_ZERO_LENGTH",
      stage: "rig",
    });
    expect(existsSync(output)).toBe(false);
    expect(run("rig-chain", input, output, "surplus").status).toBe(1);
  });

  it("emits a precision error without writing output or changing input", () => {
    const input = join(folder, "precision-chain.json");
    const output = join(folder, "precision-rig.json");
    const source = JSON.stringify({
      id: "precision",
      name: "Precision",
      start: [1e16, 0],
      end: [1e16 + 4, 0],
      boneCount: 256,
    });
    writeFileSync(input, source);
    const result = run("rig-chain", input, output);
    expect(result.status).toBe(1);
    const validation = JSON.parse(result.stderr);
    expect(validation.status).toBe("error");
    expect(validation.issues[0]).toMatchObject({
      code: "RIG_NUMERIC_PRECISION",
      stage: "rig",
      severity: 3,
    });
    expect(existsSync(output)).toBe(false);
    expect(readFileSync(input, "utf8")).toBe(source);
  });
});
