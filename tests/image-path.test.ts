import { analyzeImagePath } from "@autospine/rig";
import { describe, expect, it } from "vitest";

function image(width: number, height: number, inside: (x: number, y: number) => boolean) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (inside(x, y)) rgba.set([40, 80, 120, 255], (y * width + x) * 4);
  return { width, height, rgba };
}
describe("experimental image paths", () => {
  it("routes around a transparent notch without changing pixels or inventing acceptance", () => {
    const input = image(
      90,
      25,
      (x, y) => x >= 5 && x <= 85 && y >= 6 && y <= 15 && !(x === 35 && y <= 12),
    );
    const before = input.rgba.slice(),
      r = analyzeImagePath(input);
    expect(r.status).toBe("PATH_CANDIDATE");
    expect("connectionRepair" in r && r.connectionRepair.repairedSegments).toBe(1);
    expect(r.path!.some(([x, y]) => Math.floor(x) === 35 && y >= 13)).toBe(true);
    expect(
      r.path!.every(
        ([x, y]) => input.rgba[(Math.floor(y) * input.width + Math.floor(x)) * 4 + 3]! > 0,
      ),
    ).toBe(true);
    expect(input.rgba).toEqual(before);
    expect(r.qualityAccepted).toBe(false);
    expect(r.root).toBeNull();
  });
  it("keeps a repaired path deterministic and covariant under translation", () => {
    const inside = (x: number, y: number) =>
      x >= 5 && x <= 85 && y >= 6 && y <= 15 && !(x === 35 && y <= 12);
    const a = image(120, 50, inside),
      r = analyzeImagePath(a);
    const shifted = analyzeImagePath(image(120, 50, (x, y) => inside(x - 10, y - 7)));
    expect(analyzeImagePath(a)).toEqual(r);
    expect(shifted.path).toEqual(r.path!.map(([x, y]) => [x + 10, y + 7]));
  });
  it("stays in the interior of a wide strip with a connected narrow side detail", () => {
    const input = image(
      100,
      50,
      (x, y) =>
        (x >= 5 && x <= 94 && y >= 15 && y <= 35) || (x >= 25 && x <= 70 && y >= 11 && y <= 14),
    );
    const result = analyzeImagePath(input);
    expect(result.status).toBe("PATH_CANDIDATE");
    expect(result.path!.every((p) => p[1] >= 19 && p[1] <= 31)).toBe(true);
    expect(result.root).toBeNull();
    expect(result.qualityAccepted).toBe(false);
  });
  it("extracts an undirected supported path through a strip without joints or bones", () => {
    const result = analyzeImagePath(
      image(90, 20, (x, y) => x >= 5 && x <= 85 && y >= 6 && y <= 12),
    );
    expect(result.status).toBe("PATH_CANDIDATE");
    expect(result.path!.length).toBeGreaterThan(3);
    expect("chordDeviation" in result && result.chordDeviation).toBeCloseTo(0);
    expect(result.root).toBeNull();
    expect(result.boneCount).toBeNull();
    expect(result.qualityAccepted).toBe(false);
  });
  it("follows a curved strip while all sampled segments remain in foreground", () => {
    const input = image(
      100,
      45,
      (x, y) => x >= 5 && x <= 94 && Math.abs(y - (12 + Math.sin((x / 95) * Math.PI) * 14)) <= 4,
    );
    const r = analyzeImagePath(input);
    expect(r.status).toBe("PATH_CANDIDATE");
    expect("chordDeviation" in r && r.chordDeviation).toBeGreaterThan(8);
    expect("support" in r && r.support.foregroundFraction).toBe(1);
  });
  it("does not select a region when a faint disconnected pixel exists", () => {
    const input = image(
      90,
      20,
      (x, y) => (x >= 5 && x <= 85 && y >= 6 && y <= 12) || (x === 0 && y === 0),
    );
    input.rgba[3] = 1;
    const r = analyzeImagePath(input);
    expect(r.path).toBeNull();
    expect(r.foregroundPixels).toBe(568);
    expect(r.reasons).toContain("REGION_SELECTION_UNDETERMINED");
  });
  it("refuses to choose a branch when slice centers fall in a hole", () => {
    const r = analyzeImagePath(
      image(
        100,
        24,
        (x, y) => x >= 5 && x <= 94 && y >= 3 && y <= 20 && (x < 10 || x > 89 || y < 7 || y > 16),
      ),
    );
    expect(r.path).toBeNull();
    expect(r.reasons).toContain("CROSS_SECTION_CENTER_OUTSIDE_FOREGROUND");
  });
  it("abstains on isotropic and empty images", () => {
    expect(analyzeImagePath(image(12, 12, () => true)).path).toBeNull();
    expect(analyzeImagePath(image(12, 12, () => false)).reasons).toContain("EMPTY_FOREGROUND");
  });
  it("moves the path with the pixels and never mutates the input", () => {
    const a = image(120, 50, (x, y) => x >= 5 && x <= 85 && y >= 6 && y <= 12),
      before = a.rgba.slice();
    const ra = analyzeImagePath(a),
      rb = analyzeImagePath(image(120, 50, (x, y) => x >= 12 && x <= 92 && y >= 15 && y <= 21));
    expect(a.rgba).toEqual(before);
    expect(rb.path).toEqual(ra.path!.map((p) => [p[0] + 7, p[1] + 9]));
    expect(analyzeImagePath(a)).toEqual(ra);
  });
  it("rejects manual endpoints or classification fields injected into the pixel API", () => {
    const input = image(90, 20, (x, y) => x >= 5 && x <= 85 && y >= 6 && y <= 12);
    expect(() => analyzeImagePath({ ...input, root: [5, 9] } as typeof input)).toThrow(
      "IMAGE_REGION_INPUT",
    );
    expect(() => analyzeImagePath({ ...input, role: "hair" } as typeof input)).toThrow(
      "IMAGE_REGION_INPUT",
    );
  });
});
