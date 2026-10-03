import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { PNG } from "pngjs";

const folder = mkdtempSync(join(tmpdir(), "autospine-mesh-cli-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));
const cli = resolve("packages/cli/dist/index.js");
const source = join(folder, "part.png");
const png = new PNG({ width: 32, height: 32 });
png.data.fill(255);
writeFileSync(source, PNG.sync.write(png));
const run = (...args: string[]) => {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  if (result.error) throw result.error;
  return result;
};

describe("Gate 3.2 mesh CLI", () => {
  it("uses a portable numeric reference profile without loading a Spine file", () => {
    const profile = join(folder, "reference-profile.json");
    writeFileSync(
      profile,
      JSON.stringify({
        vertices: 10,
        hull: 4,
        maxAddedFraction: 0,
        bands: [
          { position: 0.25, widthFraction: 0.5 },
          { position: 0.5, widthFraction: 0.5 },
          { position: 0.75, widthFraction: 0.5 },
        ],
      }),
    );
    const output = join(folder, "profiled.json");
    const original = readFileSync(source);
    const result = run(
      "mesh-png",
      source,
      output,
      "--intent=rigid",
      `--reference-profile=${profile}`,
    );
    expect(result.status, result.stderr).toBe(0);
    const mesh = JSON.parse(readFileSync(output, "utf8"));
    expect(mesh.vertices).toHaveLength(10);
    expect(mesh.hull).toHaveLength(4);
    expect(result.stderr).toContain("referenceTopology");
    expect(result.stderr).toContain('"maxAddedFraction":0');
    expect(readFileSync(source)).toEqual(original);
    const invalid = join(folder, "invalid-reference-profile.json");
    writeFileSync(invalid, JSON.stringify({ vertices: 2, hull: 4 }));
    expect(
      run("mesh-png", source, join(folder, "invalid-mesh.json"), `--reference-profile=${invalid}`)
        .status,
    ).toBe(1);
  });
  it("accepts explicit rigid intent, reports limits, and preserves inputs/output", () => {
    const original = readFileSync(source);
    const output = join(folder, "rigid.json");
    const result = run("mesh-png", source, output, "0.005", "--intent=rigid");
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(output, "utf8")).vertices).toHaveLength(4);
    expect(result.stderr).toContain("DEFORMATION_NOT_VERIFIED");
    expect(result.stderr).not.toContain("INTENT_UNKNOWN");
    const saved = readFileSync(output);
    expect(run("mesh-png", source, output, "--intent=chain").status).toBe(1);
    expect(readFileSync(output)).toEqual(saved);
    expect(readFileSync(source)).toEqual(original);
  });

  it("preserves default syntax and warns about unknown purpose", () => {
    const result = run("mesh-png", source, join(folder, "unknown.json"));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("INTENT_UNKNOWN");
  });

  it.each(
    [
      ["mesh-png", source, join(folder, "bad.json"), "--intent=head"],
      ["mesh-png", source, join(folder, "bad.json"), "--intent=rigid", "--intent=chain"],
      ["parse-psd", source, join(folder, "bad.json"), "--intent=rigid"],
      ["parse-psd", source, join(folder, "bad.json"), "--reference-profile=unused.json"],
      ["mesh-png", source, join(folder, "bad.json"), "--reference-profile="],
      ["mesh-asset", source, join(folder, "bad.json"), "id", "0.005", "extra"],
    ].map((args) => ({ args })),
  )("rejects invalid CLI arguments: $args", ({ args }) => {
    expect(run(...args).status).toBe(1);
  });
});
