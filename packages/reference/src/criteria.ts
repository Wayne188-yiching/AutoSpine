import type { CompareResult } from "./compare.js";

export interface CriterionRow {
  id: string;
  ok: boolean;
  value: unknown;
}
/** Thresholds of the pre-registered acceptance (freeze-F1, ADR-017). */
export const ACCEPTANCE = Object.freeze({
  imagesOnlyFitPx: 2,
  setupPlacementPx: 0.5,
  loopSeamPx: 0.5,
  seamDriftPx: 11,
  stretchVsArtist: 1.5,
  recall: 0.8,
  precision: 0.7,
  critic: 0.6,
  amplitude: 0.6,
});
/**
 * Every automatable criterion of the pre-registered acceptance. A3 (runtime load) is implied by
 * the comparison running; A5 (editor round trip) and E (artist approval) are checked separately.
 */
export function checkAcceptance(
  r: CompareResult,
  seams: { maxDrift: number }[],
  expectedAttachments?: number,
): { rows: CriterionRow[]; pass: boolean } {
  const rows: CriterionRow[] = [];
  const add = (id: string, ok: boolean, value: unknown) => rows.push({ id, ok, value });
  const animations = Object.keys(r.performance);
  add(
    "A1 imagesOnly fit <= 2 px",
    r.engineering.A1_imagesOnlyVsArtistSetup.maxPx <= ACCEPTANCE.imagesOnlyFitPx,
    r.engineering.A1_imagesOnlyVsArtistSetup.maxPx,
  );
  add(
    "A2 setup placement <= 0.5 px",
    r.engineering.A2_setupPlacement.maxPx <= ACCEPTANCE.setupPlacementPx,
    r.engineering.A2_setupPlacement.maxPx,
  );
  for (const a of animations) {
    const v = r.engineering.A4_loopSeam[`${a}:generated`] ?? Infinity;
    add(`A4 loop seam ${a} <= 0.5 px`, v <= ACCEPTANCE.loopSeamPx, v);
  }
  for (const a of animations)
    add(
      `B1 visible inversions ${a} = 0`,
      !Object.keys(r.deformation[a]!.generated.visibleInversions).length,
      r.deformation[a]!.generated.visibleInversions,
    );
  const seam = Math.max(0, ...seams.map((s) => s.maxDrift));
  add("B2 seam drift <= 11 px", seam <= ACCEPTANCE.seamDriftPx, +seam.toFixed(3));
  for (const a of animations) {
    const g = r.deformation[a]!.generated.maxCharacterStretch?.value ?? 0,
      s = r.deformation[a]!.artist.maxCharacterStretch?.value ?? 0;
    add(
      `B3 stretch ${a} <= 1.5 x artist`,
      g <= ACCEPTANCE.stretchVsArtist * s,
      `${g} / ${+(ACCEPTANCE.stretchVsArtist * s).toFixed(3)}`,
    );
  }
  const images = (a: Record<string, number>) =>
    (a.region ?? 0) + (a.mesh ?? 0) + (a.linkedmesh ?? 0);
  const total = images(r.structure.generated.attachments),
    expected = expectedAttachments ?? images(r.structure.artist.attachments);
  add(`C1 attachments = ${expected}`, total === expected, total);
  for (const a of animations) {
    const m = r.motion[a] as {
      recall: number;
      precision: number;
      amplitudeWithinX2: number | null;
    };
    add(`C2 recall ${a} >= 0.8`, m.recall >= ACCEPTANCE.recall, m.recall);
    add(`C3 precision ${a} >= 0.7`, m.precision >= ACCEPTANCE.precision, m.precision);
  }
  for (const a of animations) {
    const p = r.performance[a]!.review;
    add(`D1 critic ${a} >= 60%`, p.within / p.total >= ACCEPTANCE.critic, `${p.within}/${p.total}`);
  }
  for (const a of animations) {
    const m = r.motion[a] as { amplitudeWithinX2: number | null };
    add(
      `D2 amplitude ${a} >= 60%`,
      (m.amplitudeWithinX2 ?? 0) >= ACCEPTANCE.amplitude,
      m.amplitudeWithinX2,
    );
  }
  return { rows, pass: rows.every((x) => x.ok) };
}
