import { analyzeImageConnections } from "@autospine/rig";
import { describe, expect, it } from "vitest";

function raster(width: number, height: number, inside: (x: number, y: number) => boolean) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (inside(x, y)) rgba.set([60, 80, 100, 255], (y * width + x) * 4);
  return { width, height, rgba };
}

describe("PNG connection cues", () => {
  it("retains both ends of a uniform strip without choosing a root or joint", () => {
    const result = analyzeImageConnections(
      raster(42, 12, (x, y) => x >= 1 && x <= 40 && y >= 4 && y <= 7),
    );
    const r = result.regions[0]!;
    expect(r.endCandidates).toHaveLength(2);
    expect(r.endCandidates[0]!.transverseSpan).toBeCloseTo(4);
    expect(r.endCandidates[1]!.transverseSpan).toBeCloseTo(4);
    expect(r.widerEndHint).toBeNull();
    expect(r.joint).toBeNull();
    expect(result.pivot).toBeNull();
    expect(result.boneCount).toBeNull();
    expect(result.qualityAccepted).toBe(false);
  });
  it("identifies taper as a width cue while explicitly withholding anatomical root approval", () => {
    const r = analyzeImageConnections(
      raster(64, 24, (x, y) => x >= 2 && x <= 60 && Math.abs(y - 12) <= Math.floor((61 - x) / 8)),
    ).regions[0]!;
    expect(r.widerEndHint).toBe(0);
    expect(r.reasons).toContain("WIDER_CAP_IS_NOT_A_VERIFIED_ROOT");
    expect(r.parent).toBeNull();
  });
  it("keeps disconnected and faint details without selecting the largest component", () => {
    const input = raster(
      50,
      20,
      (x, y) => (x >= 2 && x <= 42 && y >= 4 && y <= 7) || (x === 48 && y === 18),
    );
    input.rgba[(18 * 50 + 48) * 4 + 3] = 1;
    const result = analyzeImageConnections(input);
    expect(result.regions.map((r) => r.pixels)).toEqual([164, 1]);
    expect(result.foregroundPixels).toBe(165);
    expect(result.selectedRegion).toBeNull();
    expect(result.reasons).toContain("REGION_SELECTION_UNDETERMINED");
  });
  it("reports all four border contacts without interpreting clipping as a joint", () => {
    const r = analyzeImageConnections(raster(10, 10, () => true)).regions[0]!;
    expect(r.borderContacts).toEqual({ left: 10, right: 10, top: 10, bottom: 10 });
    expect(r.reasons).toContain("IMAGE_BORDER_CONTACT_IS_NOT_A_VERIFIED_CUT");
    expect(r.endCandidates).toEqual([]);
  });
  it("translates end evidence and preserves widths and uncertainty", () => {
    const a = analyzeImageConnections(
      raster(70, 30, (x, y) => x >= 2 && x <= 45 && y >= 4 && y <= 8),
    ).regions[0]!;
    const b = analyzeImageConnections(
      raster(70, 30, (x, y) => x >= 7 && x <= 50 && y >= 11 && y <= 15),
    ).regions[0]!;
    expect(b.endCandidates.map((c) => c.center)).toEqual(
      a.endCandidates.map((c) => [c.center[0] + 5, c.center[1] + 7]),
    );
    expect(b.endCandidates.map((c) => c.transverseSpan)).toEqual(
      a.endCandidates.map((c) => c.transverseSpan),
    );
    expect(b.widerEndHint).toBe(a.widerEndHint);
  });
  it("is deterministic and does not mutate pixels or treat hidden RGB as evidence", () => {
    const input = raster(42, 12, (x, y) => x >= 1 && x <= 40 && y >= 4 && y <= 7);
    const before = input.rgba.slice(),
      a = analyzeImageConnections(input);
    expect(input.rgba).toEqual(before);
    for (let p = 0; p < input.rgba.length; p += 4)
      if (!input.rgba[p + 3]) input.rgba.set([255, 0, 0], p);
    expect(analyzeImageConnections(input)).toEqual(a);
  });
  it("rejects injected manual roles and geometry rather than silently using them", () => {
    const input = raster(42, 12, (x, y) => x >= 1 && x <= 40 && y >= 4 && y <= 7);
    expect(() => analyzeImageConnections({ ...input, role: "hair" } as typeof input)).toThrow(
      "IMAGE_REGION_INPUT",
    );
    expect(() => analyzeImageConnections({ ...input, pivot: [10, 4] } as typeof input)).toThrow(
      "IMAGE_REGION_INPUT",
    );
  });
});
