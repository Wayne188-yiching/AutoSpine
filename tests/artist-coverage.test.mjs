import { describe, it, expect } from "vitest";
import {
  measureRasterCoverage,
  compareArtistCoverage,
  selectArtistForeground,
} from "../tools/reference-topology.mjs";
const box = (right = 10) => ({
  vertices: [
    [0, 0],
    [right, 0],
    [right, 10],
    [0, 10],
  ],
  hull: [0, 1, 2, 3],
});
const alpha = Uint8Array.from({ length: 100 }, (_, i) => (i % 10 < 8 ? 255 : 0));
describe("Same-attachment padding with raw foreground protection", () => {
  it("explicitly limits the target to artist-used pixels without hiding excluded source content", () => {
    const region = selectArtistForeground(box(7), alpha, 10, 10);
    expect(region).toMatchObject({
      sourceForeground: 80,
      targetForeground: 70,
      excludedForeground: 10,
    });
    expect(compareArtistCoverage(box(7), box(7), alpha, 10, 10, true)).toMatchObject({
      status: "PASSED",
      excludedForeground: 10,
      generated: { missedFraction: 0 },
    });
    expect(compareArtistCoverage(box(7), box(8), alpha, 10, 10, true)).toMatchObject({
      status: "REJECTED",
      outsideReferenceForeground: 10,
    });
    expect(alpha.filter((a) => a > 0)).toHaveLength(80);
  });
  it("retains leak checks within the selected region and refuses empty selections", () => {
    expect(compareArtistCoverage(box(7), box(6), alpha, 10, 10, true).status).toBe("REJECTED");
    expect(() =>
      selectArtistForeground(
        {
          vertices: [
            [8, 0],
            [10, 0],
            [10, 10],
            [8, 10],
          ],
          hull: [0, 1, 2, 3],
        },
        alpha,
        10,
        10,
      ),
    ).toThrow("NO_FOREGROUND");
  });
  it("permits artist-matched padding above the historical 2%", () => {
    expect(measureRasterCoverage(box(), alpha, 10, 10)).toEqual({
      foreground: 80,
      missed: 0,
      added: 20,
      missedFraction: 0,
      addedFraction: 0.25,
    });
    expect(compareArtistCoverage(box(), box(), alpha, 10, 10)).toMatchObject({
      status: "PASSED",
      maxAddedFraction: 0.25,
      maxMissedFraction: 0.02,
    });
  });
  it("rejects added area beyond this artist even when another attachment has a larger budget", () => {
    expect(compareArtistCoverage(box(8), box(9), alpha, 10, 10)).toMatchObject({
      status: "REJECTED",
      maxAddedFraction: 0,
    });
    expect(compareArtistCoverage(box(10), box(9), alpha, 10, 10).status).toBe("PASSED");
  });
  it("never inherits an artist leak or erases detached original pixels", () => {
    expect(compareArtistCoverage(box(7), box(7), alpha, 10, 10)).toMatchObject({
      status: "REJECTED",
      generated: { missedFraction: 0.125 },
    });
    const detached = alpha.slice();
    for (let y = 0; y < 10; y++) detached[y * 10 + 9] = 255;
    expect(compareArtistCoverage(box(), box(8), detached, 10, 10).status).toBe("REJECTED");
  });
  it("checks exact threshold boundaries with unrounded pixel counts", () => {
    const opaque = new Uint8Array(100).fill(255);
    expect(
      compareArtistCoverage(
        box(),
        {
          vertices: [
            [0, 0],
            [10, 0],
            [10, 9],
            [8, 9],
            [8, 10],
            [0, 10],
          ],
          hull: [0, 1, 2, 3, 4, 5],
        },
        opaque,
        10,
        10,
      ).status,
    ).toBe("PASSED");
    expect(
      compareArtistCoverage(
        box(),
        {
          vertices: [
            [0, 0],
            [10, 0],
            [10, 9],
            [7, 9],
            [7, 10],
            [0, 10],
          ],
          hull: [0, 1, 2, 3, 4, 5],
        },
        opaque,
        10,
        10,
      ).status,
    ).toBe("REJECTED");
    expect(() => measureRasterCoverage(box(), new Uint8Array(100), 10, 10)).toThrow("EMPTY");
  });
});
