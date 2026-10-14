import { describe, expect, it } from "vitest";
import { buildCharacter } from "@autospine/character";
import { loadSkeleton, premultiply, reviewFrames } from "@autospine/reference";
import { fixtureLayout, fixturePlan, fixtureRgba } from "./character-fixture.js";

describe("review video frames: wireframe, bones, motion", () => {
  const built = buildCharacter(fixturePlan(), fixtureLayout());
  const texture = (path: string) => {
    const { width, height, rgba } = fixtureRgba(path);
    return premultiply(width, height, rgba);
  };
  const view = { x0: -70, y0: 310, scale: 0.5, width: 70, height: 160 };

  it("plays every segment in order, each loop of the animation, side by side", () => {
    const sides = [loadSkeleton(built.document), loadSkeleton(built.document)];
    const r = reviewFrames(sides, texture, view, "IDLE", { loops: 1 });
    expect([r.frames, r.loops, r.width, r.height]).toEqual([80, 1, 144, 160]);
    const played = [...r.play()];
    expect(played).toHaveLength(240);
    expect([played[0]!.segment, played[80]!.segment, played[160]!.segment]).toEqual([
      "wireframe",
      "bones",
      "motion",
    ]);
    expect(r.segmentStart("motion")).toBeCloseTo(160 / 30, 6);
    // Overlays: the wireframe draws cyan edges and the bones white joints on a dimmed copy.
    const count = (rgb: Uint8Array, test: (r: number, g: number, b: number) => boolean) => {
      let n = 0;
      for (let i = 0; i < rgb.length; i += 3) if (test(rgb[i]!, rgb[i + 1]!, rgb[i + 2]!)) n++;
      return n;
    };
    const cyan = (r: number, g: number, b: number) => b > 200 && g > 180 && r < 140;
    const white = (r: number, g: number, b: number) => r > 250 && g > 250 && b > 250;
    expect(count(played[0]!.raster.rgb, cyan)).toBeGreaterThan(50);
    expect(count(played[160]!.raster.rgb, cyan)).toBe(0);
    expect(count(played[80]!.raster.rgb, white)).toBeGreaterThan(20);
    // Both sides show the same build here, so the halves match.
    const row = (rgb: Uint8Array, y: number, x0: number) =>
      rgb.slice((y * 144 + x0) * 3, (y * 144 + x0 + 70) * 3);
    expect([...row(played[170]!.raster.rgb, 80, 0)]).toEqual([
      ...row(played[170]!.raster.rgb, 80, 74),
    ]);
  });
});
