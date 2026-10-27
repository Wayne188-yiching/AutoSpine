import type { KeyposeEase } from "@autospine/schemas";
import { failStage } from "@autospine/rig";

/**
 * Measured motion priors (ADR-032): what hand-made animations of each kind do, measured on the
 * official 4.0 runtime at 30 fps over the 2026-10 batch (68 animations in 19 files, 15 independent
 * arts; reskins and duplicated art count once). They are starting values for a plan whose brief says
 * nothing more, not targets: characters differ by a factor of ten on most of these numbers, and the
 * ranges are part of the prior.
 *
 * Units:
 * - `Hw`: head widths, the width of the plan's face probe on the images-only setup (the critic's
 *   unit). `OfHeight`: a fraction of the figure's height.
 * - `At`: a fraction of the animation's frames.
 * - `Deg`: peak-to-peak rotation of a part against the body (a best-fit rotation of its vertices),
 *   median over the parts of that role; `MaxDeg` the most-moving part.
 * - `Frames`: at 30 fps. `Share`: a fraction of the shown parts, or of the key segments for eases.
 */
export interface PriorStat {
  readonly median: number;
  readonly min: number;
  readonly max: number;
}
const s = (median: number, min: number, max: number): PriorStat => ({ median, min, max });

export const MOTION_PRIORS = {
  /**
   * Character idle loops (8 animations, 7 arts). The body probe is the hips or the lower body: the
   * hips barely move and the head travels further, a few frames later. The ADR-019 survey measured
   * chests and torsos at a median 0.14 hw (12 idles, 9 characters).
   */
  idle: {
    animations: 8,
    arts: 7,
    pelvisHw: s(0.061, 0.017, 0.141),
    pelvisOfHeight: s(0.02, 0.008, 0.059),
    headVsPelvis: s(1.64, 0.69, 3.16),
    headLagFrames: s(3, -1, 10),
    cycleSeconds: s(2.33, 0.97, 3),
    strandDeg: s(16.3, 8.2, 22.9),
    strandTipLagFrames: s(4, 0, 26),
    limbDeg: s(3.5, 1.5, 26.9),
    limbMaxDeg: s(9.9, 3.4, 51.3),
    parallaxYHw: s(0.021, 0.01, 0.082),
    keyGapFrames: s(20, 12.5, 45),
  },
  /** Walk loops: one character in three sizes (6 animations, 1 art) - a weak prior. */
  walk: {
    animations: 6,
    arts: 1,
    bobOfHeight: s(0.116, 0.112, 0.12),
    bobHw: s(0.336, 0.292, 0.379),
    bobsPerStride: s(2, 2, 2),
    limbDeg: s(89, 88.7, 89.2),
    limbMaxDeg: s(146, 146, 146),
    strandDeg: s(35.8, 35.8, 35.8),
    linearShare: s(0.43, 0.43, 0.43),
  },
  /**
   * Prop, logo and effect loops (6 animations, 4 arts): the base stays still; alpha, image
   * sequences and effect parts carry the motion.
   */
  propLoop: {
    animations: 6,
    arts: 4,
    baseHw: s(0, 0, 0.01),
    tiltDeg: s(4.5, 0, 9.2),
    alphaShare: s(0.35, 0, 1),
    keyGapFrames: s(5, 3, 5),
  },
  /** Every character one-shot together (31 animations, 7 arts): what all kinds share. */
  characterOneShot: {
    animations: 31,
    arts: 7,
    limbDeg: s(41.4, 0, 392.8),
    strandDeg: s(34.8, 0, 138.6),
    strandTipLagFrames: s(1, -7, 2),
    tiltDeg: s(14.7, 0, 365),
    sideHw: s(0.19, 0, 4.4),
    keyGapFrames: s(7.75, 2, 30),
    inOutShare: s(0.61, 0, 0.95),
    alphaShare: s(0.31, 0, 0.69),
  },
  /** Character entries (3 animations, 3 arts): rise from below, overshoot, half-transparent start. */
  entry: {
    animations: 3,
    arts: 3,
    startBelowHw: s(0.62, -0.19, 1.19),
    aboveEndHw: s(0.27, 0.05, 1.55),
    peakAt: s(0.52, 0.31, 0.55),
    startScale: s(0.48, 0.03, 0.91),
    peakScale: s(1.27, 1.01, 1.38),
    alphaStart: s(0.51, 0.44, 0.83),
    alphaFullAt: s(0.34, 0.06, 0.69),
    tiltPeakDeg: s(21.9, 6.6, 202.5),
    limbDeg: s(42, 40.5, 151.9),
  },
  /** Logo and prop entries (2 animations, 2 arts): fade in, no scale. */
  propEntry: {
    animations: 2,
    arts: 2,
    alphaFullAt: s(0.21, 0, 0.42),
    startScale: s(1, 1, 1),
  },
  /** Character exits (2 animations, 2 arts): start at once, lift, then drop and shrink; no fade. */
  exit: {
    animations: 2,
    arts: 2,
    startAt: s(0.055, 0.04, 0.07),
    liftHw: s(0.15, 0.14, 0.16),
    endDropHw: s(0.7, 0.65, 0.76),
    peakScale: s(1.08, 1.02, 1.15),
    endScale: s(0.51, 0.12, 0.9),
    alphaEnd: s(0.79, 0.72, 0.85),
    tiltDeg: s(19.3, 14, 24.6),
    limbDeg: s(59.3, 27.9, 90.7),
  },
  /** A logo exit (1 animation): fade out by half way while growing. */
  propExit: {
    animations: 1,
    arts: 1,
    visibleUntil: s(0.47, 0.47, 0.47),
    endScale: s(1.17, 1.17, 1.17),
  },
  /** Character wins and jumps (5 animations, 4 arts): a quick hop, then the pose plays out. */
  jump: {
    animations: 5,
    arts: 4,
    dipHw: s(0.156, 0, 0.195),
    dipAt: s(0.13, 0, 0.17),
    liftHw: s(0.357, 0.088, 0.464),
    liftAt: s(0.25, 0.23, 0.87),
    landAt: s(0.32, 0.28, 0.98),
    sideHw: s(0.22, 0.12, 0.32),
    limbDeg: s(54.3, 10.8, 62.1),
    strandDeg: s(51.6, 34.5, 77.4),
    keyGapFrames: s(6, 5, 6.5),
  },
  /** Character charges (3 animations, 3 arts): a lean and sway, no lift, no scale-up. */
  charge: {
    animations: 3,
    arts: 3,
    tiltDeg: s(12.9, 12.5, 13.6),
    sideHw: s(0.18, 0.17, 0.24),
    peakScale: s(1.01, 1, 1.04),
    limbDeg: s(21.6, 12.9, 118.4),
    strandDeg: s(52.8, 34.6, 72.9),
  },
  /** Level-up transitions (2 units, 1 art): squash, then grow past the new size. */
  levelup: {
    animations: 4,
    arts: 1,
    endScale: s(1.17, 1.15, 1.18),
    /** Against the end size. */
    peakScale: s(1.02, 1, 1.04),
    lowScale: s(0.86, 0.81, 0.9),
    lowAt: s(0.22, 0.1, 0.35),
    peakAt: s(0.68, 0.6, 0.75),
  },
  /** Looks (2 animations, 1 art): the head and body turn both ways. */
  look: {
    animations: 2,
    arts: 1,
    tiltDeg: s(34.7, 34.7, 34.7),
    sideHw: s(0.39, 0.39, 0.39),
  },
  /** Other character transitions (11 units, 3 arts): small, a slight tilt, limbs move. */
  transition: {
    animations: 14,
    arts: 3,
    liftHw: s(0.031, 0, 0.39),
    liftAt: s(0.6, 0, 1),
    tiltDeg: s(7.3, 0, 57.2),
    sideHw: s(0.11, 0, 0.46),
    limbDeg: s(31, 0, 392.8),
    strandDeg: s(10.8, 0, 72.8),
    keyGapFrames: s(9, 2, 30),
  },
  /**
   * Clap loops (1 animation, 1 art: Jackpot mummy cat, 2026-10-19) - a weak prior. Four 15-frame
   * claps per body sway, the contact half way through each beat. The body leans one way for two
   * claps and the other way for two, further at each contact, and dips as the hands meet. Open
   * hands reach about the full arm just above the shoulders; they meet between the shoulders at
   * shoulder height. `Reach`: a fraction of the shoulder-to-wrist length.
   */
  clap: {
    animations: 1,
    arts: 1,
    beatFrames: s(15, 15, 15),
    beatsPerSway: s(4, 4, 4),
    contactAtBeat: s(0.53, 0.53, 0.53),
    leanOpenDeg: s(11.4, 11.4, 11.4),
    leanContactDeg: s(17, 15, 20.3),
    headLeanDeg: s(8.5, 8.5, 8.5),
    dipHw: s(0.047, 0.047, 0.047),
    openReach: s(1.08, 0.975, 1.184),
    openAboveShoulderDeg: s(7.2, 7.1, 7.3),
    contactGapHw: s(0.209, 0.209, 0.209),
    contactBelowShoulderHw: s(0.028, 0.028, 0.028),
    palmTurnDeg: s(94.2, 78.2, 110.2),
  },
  /**
   * Free hands in an idle (1 animation, 1 art: the mummy cat, also in the ADR-019 survey) - a weak
   * prior beside ADR-019's 1.3-2.5x. The hands bob twice per breath as much as once, trail the
   * body by 4-6 frames and travel about 3x the body.
   */
  idleHands: {
    animations: 1,
    arts: 1,
    travelVsBody: s(2.9, 2.8, 3),
    relTravelVsBody: s(2.6, 2.3, 2.9),
    correlation: s(0.76, 0.61, 0.91),
    lagFrames: s(5, 4, 6),
    perBreathHw: s(0.04, 0.033, 0.047),
    twicePerBreathHw: s(0.054, 0.052, 0.055),
    palmDeg: s(33.2, 30.6, 35.7),
  },
  /**
   * Rise-and-squash character entries (1 animation, 1 art: the mummy cat) - a weak prior, the
   * second entry style beside the scale-in `entry`. No scale and no fade: the figure rises from far
   * below, is in place by a third, barely overshoots, and the body lands - the chest stretches then
   * squashes, the head 2 frames behind it, the face slides down, up, down - while the arms fling
   * up past the shoulders and drop on the landing. Times are fractions of the frames.
   */
  entryRise: {
    animations: 1,
    arts: 1,
    startBelowHw: s(1.33, 1.33, 1.33),
    arriveAt: s(0.33, 0.33, 0.33),
    overshootHw: s(0.019, 0.019, 0.019),
    sinkHw: s(0.011, 0.011, 0.011),
    sinkAt: s(0.6, 0.6, 0.6),
    startTiltDeg: s(18, 18, 18),
    counterTiltDeg: s(5.6, 5.6, 5.6),
    counterTiltAt: s(0.4, 0.4, 0.4),
    chestStretchHw: s(0.023, 0.023, 0.023),
    chestStretchAt: s(0.37, 0.37, 0.37),
    chestSquashHw: s(0.087, 0.087, 0.087),
    chestSquashAt: s(0.67, 0.67, 0.67),
    headLagFrames: s(2, 2, 2),
    headStretchHw: s(0.027, 0.027, 0.027),
    headSquashHw: s(0.147, 0.147, 0.147),
    faceDownStartHw: s(0.283, 0.283, 0.283),
    faceUpHw: s(0.131, 0.131, 0.131),
    faceUpAt: s(0.47, 0.47, 0.47),
    faceDownHw: s(0.154, 0.154, 0.154),
    faceDownAt: s(0.73, 0.73, 0.73),
    handStartOutReach: s(0.34, 0.1, 0.58),
    handPeakAboveShoulderReach: s(0.59, 0.46, 0.72),
    handPeakOutReach: s(1.02, 0.97, 1.06),
    handPeakAt: s(0.3, 0.27, 0.33),
    handLowBelowShoulderReach: s(0.28, 0.26, 0.3),
    handLowOutReach: s(0.48, 0.44, 0.52),
    handLowAt: s(0.65, 0.53, 0.77),
  },
} as const;

/**
 * A prior seen on fewer independent arts than this is weak (ADR-032): a starting value to check
 * against the brief and the video, not a rule, until a second art agrees.
 */
export const WEAK_PRIOR_ARTS = 2;
export type PriorKind = keyof typeof MOTION_PRIORS;
export function isWeakPrior(kind: PriorKind): boolean {
  return MOTION_PRIORS[kind].arts < WEAK_PRIOR_ARTS;
}
/** Wrist targets never go past this share of the arm, so the hand stays on the forearm. */
const REACH_LIMIT = 0.98;

/** One-shot templates (ADR-032), chosen from the animation name. */
export type OneShotKind =
  "entry" | "exit" | "jump" | "charge" | "press" | "levelup" | "look" | "transition";
/**
 * The template an animation name asks for: the 2026-10 pre-registered keywords (whole words, so
 * "GoldenDragon" is no `End`). Anything else is a generic `transition`.
 */
export function oneShotKind(name: string): OneShotKind {
  const n = name.replace(/[@/]/g, "_");
  if (/(^|[^A-Za-z])In$|^\d*_?In([^a-z]|$)|into|Appear/i.test(n)) return "entry";
  if (/(^|[^A-Za-z])Out$|^out$/i.test(n)) return "exit";
  if (/Win|Goal|Jump/i.test(n)) return "jump";
  if (/Energy|Charge/i.test(n)) return "charge";
  if (/Press/i.test(n)) return "press";
  if (/LV\d-LV\d|LevelUp|Level_?Up/i.test(n)) return "levelup";
  if (/Look/i.test(n)) return "look";
  return "transition";
}

export interface TemplateKey<V> {
  frame: number;
  value: V;
  ease?: KeyposeEase;
}
/**
 * Keys for a one-shot, in plan form: frames, IR px (y down: up is negative), clockwise degrees,
 * scale factors, alpha times the setup alpha. `translate`, `scale` and `rotate` drive a `move`
 * bone above everything (pivot at the feet for a character, the centre for a prop); `head` the
 * head bone for a look; `alpha` every shown part without its own colour keys. An empty list
 * leaves that channel at rest.
 */
export interface OneShotTemplate {
  kind: OneShotKind;
  subject: "character" | "prop";
  translate: TemplateKey<[number, number]>[];
  scale: TemplateKey<[number, number]>[];
  rotate: TemplateKey<number>[];
  head: TemplateKey<number>[];
  alpha: { frame: number; alpha: number; ease?: KeyposeEase }[];
  /**
   * Secondary motion: peak-to-peak swing of limbs and strands against the body (degrees) over
   * one period of `period` frames, strand tips `tipLagFrames` behind the root; zero for props.
   */
  swing: { limbDeg: number; strandDeg: number; tipLagFrames: number; period: number };
  /** The artists' median key spacing for this kind (frames): key secondary parts this often. */
  keyEvery: number;
  /** True when the template rests on a weak prior (fewer than two arts). */
  weak: boolean;
  /**
   * Rise-style entries only: the torso lean (clockwise degrees), and the chest, head and face
   * offsets from their settled pose (px, y down: up is negative), keyed on the chest, head and
   * face-slide controls rather than on `move`.
   */
  body?: {
    tilt: TemplateKey<number>[];
    chest: TemplateKey<number>[];
    head: TemplateKey<number>[];
    face: TemplateKey<number>[];
  };
  /**
   * Rise-style entries only: each wrist against its shoulder in arm reaches, [outward, down]
   * (outward is away from the body's midline, up is negative), never past 0.98 of the arm. After
   * the last key the arms ease back to the plan's rest by the last frame, handing over to the idle.
   */
  arms?: TemplateKey<[number, number]>[];
}
/** Entry styles: `pop` scales in from below (3 arts), `rise` rises and squashes (1 art, weak). */
export type EntryStyle = "pop" | "rise";

const r2 = (v: number) => +v.toFixed(2);
/**
 * Template keys for a one-shot from the measured priors (medians, rounded inward where a single
 * art dominates). `unit` is the head width in px for a character, the prop's width for a prop.
 */
export function oneShotTemplate(
  name: string,
  options: { frames: number; unit: number; subject: "character" | "prop"; entry?: EntryStyle },
): OneShotTemplate {
  const { frames: N, unit: u, subject, entry: entryStyle = "pop" } = options;
  if (!Number.isInteger(N) || N < 2 || N > 3600)
    failStage("animation", "PRIOR_FRAMES", "A one-shot template needs 2..3600 frames");
  if (!(u > 0) || !Number.isFinite(u))
    failStage("animation", "PRIOR_UNIT", "A one-shot template needs a positive unit (px)");
  const kind = oneShotKind(name);
  const F = (x: number) => Math.max(0, Math.min(N, Math.round(x * N)));
  const P = MOTION_PRIORS;
  const out: OneShotTemplate = {
    kind,
    subject,
    translate: [],
    scale: [],
    rotate: [],
    head: [],
    alpha: [],
    swing: { limbDeg: 0, strandDeg: 0, tipLagFrames: 0, period: N },
    keyEvery: Math.round(P.characterOneShot.keyGapFrames.median),
    weak: false,
  };
  // Each helper takes keys as [fraction of the frames, value..., ease?].
  type E = KeyposeEase | undefined;
  const eased = (ease: E) => (ease ? { ease } : {});
  const T = (...keys: [number, number, number, E?][]) => {
    for (const [x, dx, dy, ease] of keys)
      out.translate.push({ frame: F(x), value: [r2(dx * u), r2(dy * u)], ...eased(ease) });
  };
  const S = (...keys: [number, number, E?][]) => {
    for (const [x, k, ease] of keys)
      out.scale.push({ frame: F(x), value: [r2(k), r2(k)], ...eased(ease) });
  };
  const R = (...keys: [number, number, E?][]) => {
    for (const [x, deg, ease] of keys)
      out.rotate.push({ frame: F(x), value: r2(deg), ...eased(ease) });
  };
  const A = (...keys: [number, number, E?][]) => {
    for (const [x, alpha, ease] of keys)
      out.alpha.push({ frame: F(x), alpha: r2(alpha), ...eased(ease) });
  };
  const swing = (limbDeg: number, strandDeg: number, sways = 1) => {
    out.swing = {
      limbDeg: r2(limbDeg),
      strandDeg: r2(strandDeg),
      tipLagFrames: P.characterOneShot.strandTipLagFrames.median,
      period: Math.max(2, Math.round(N / sways)),
    };
  };

  if (subject === "prop") {
    // Props and logos: the base stays put; entries and exits fade (ADR-032).
    if (kind === "entry") A([0, 0], [0.4, 1, "sine"]);
    else if (kind === "exit") {
      const e = P.propExit;
      A([0, 1], [0.13, 1], [e.visibleUntil.median, 0, "sine"]);
      S([0, 1], [0.13, 1], [0.6, e.endScale.median, "out"]);
    }
    out.keyEvery = P.propLoop.keyGapFrames.median;
    return dedupe(out);
  }
  switch (kind) {
    case "entry": {
      if (entryStyle === "rise") {
        riseEntry(out, N, F, u, T);
        break;
      }
      // Rise from below with an overshoot, scale in from about half, fade from half alpha.
      const e = P.entry;
      T([0, 0, e.startBelowHw.median], [e.peakAt.median, 0, -e.aboveEndHw.median, "out"]);
      T([0.75, 0, 0, "sine"]);
      S([0, e.startScale.median], [e.peakAt.median, e.peakScale.median, "out"], [0.75, 1, "sine"]);
      // Tilt: the geometric mean of the smallest and the median peak (one art spun 180 degrees),
      // back upright on landing.
      const tilt = Math.round(Math.sqrt(e.tiltPeakDeg.min * e.tiltPeakDeg.median));
      R([0, 0], [e.peakAt.median, tilt, "out"], [0.75, 0, "sine"]);
      A([0, e.alphaStart.median], [e.alphaFullAt.median, 1, "sine"]);
      swing(e.limbDeg.median, P.characterOneShot.strandDeg.median);
      break;
    }
    case "exit": {
      // No hold: a lift, then drop and shrink. Characters keep their alpha.
      const e = P.exit,
        tilt = e.tiltDeg.median / 2;
      T([0, 0, 0], [0.3, 0, -e.liftHw.median, "out"], [1, 0, e.endDropHw.median, "in"]);
      S([0, 1], [0.5, e.peakScale.median, "sine"], [1, e.endScale.median, "in"]);
      R([0, 0], [0.3, tilt, "sine"], [0.6, -tilt, "sine"], [1, 0, "sine"]);
      swing(e.limbDeg.median, P.characterOneShot.strandDeg.median, 2);
      break;
    }
    case "jump": {
      // Dip, hop, land within the first third; the pose plays out in the limbs.
      const j = P.jump,
        side = j.sideHw.median;
      T([0, 0, 0], [j.dipAt.median, 0, j.dipHw.median, "sine"]);
      T([j.liftAt.median, side / 2, -j.liftHw.median, "out"], [j.landAt.median, 0, 0, "in"]);
      T([0.5, -side / 4, 0, "sine"], [0.75, 0, 0, "sine"]);
      // The animals' larger tilts came from another start pose (A6); in place they lean 5 degrees.
      R([0, 0], [j.liftAt.median, -5, "out"], [0.5, 3, "sine"], [0.75, 0, "sine"]);
      swing(j.limbDeg.median, j.strandDeg.median);
      out.keyEvery = j.keyGapFrames.median;
      break;
    }
    case "charge": {
      // A lean one way and the other with a side shift; no scale-up, no shake.
      const c = P.charge;
      const t = c.tiltDeg.median / 2,
        x = c.sideHw.median / 2;
      R([0, 0], [0.3, t, "sine"], [0.65, -t, "sine"], [0.95, 0, "sine"]);
      T([0, 0, 0], [0.3, x, 0, "sine"], [0.65, -x, 0, "sine"], [0.95, 0, 0, "sine"]);
      swing(c.limbDeg.median, c.strandDeg.median, 1.5);
      break;
    }
    case "press":
      // Only a prop press was seen (no squash, effect parts flash): a character takes a nudge.
      T([0, 0, 0], [0.2, 0, 0.03, "sine"], [0.45, 0, 0, "sine"]);
      swing(P.transition.limbDeg.median, P.transition.strandDeg.median);
      break;
    case "levelup": {
      // Squash, grow past the new size, settle on it (one art, scaled about the feet).
      const l = P.levelup,
        end = l.endScale.median;
      S([0, 1], [l.lowAt.median, l.lowScale.median, "sine"]);
      S([l.peakAt.median, end * l.peakScale.median, "out"], [0.85, end, "sine"]);
      break;
    }
    case "look": {
      // Head turns both ways (one art: about 35 degrees peak to peak), 4 frames per turn.
      const h = P.look.tiltDeg.median / 2,
        at = (x: number, d = 0) => Math.min(N, F(x) + d);
      out.head.push(
        { frame: at(0), value: 0 },
        { frame: at(0.2), value: 0 },
        { frame: at(0.2, 4), value: r2(h), ease: "out" },
        { frame: at(0.55), value: r2(h) },
        { frame: at(0.55, 4), value: r2(-h), ease: "out" },
        { frame: at(0.85), value: r2(-h) },
        { frame: at(0.85, 4), value: 0, ease: "out" },
      );
      swing(P.transition.limbDeg.median, P.transition.strandDeg.median, 2);
      break;
    }
    case "transition": {
      const t = P.transition,
        tilt = t.tiltDeg.median / 2;
      T([0, 0, 0], [0.3, 0, 0.03, "sine"], [t.liftAt.median, 0, -t.liftHw.median, "sine"]);
      T([0.9, 0, 0, "sine"]);
      R([0, 0], [0.3, tilt, "sine"], [0.6, -tilt, "sine"], [0.9, 0, "sine"]);
      swing(t.limbDeg.median, t.strandDeg.median);
      out.keyEvery = t.keyGapFrames.median;
      break;
    }
  }
  return dedupe(out);
}
/**
 * The rise-and-squash entry (weak prior, one art): the figure rises on `move` without scale or
 * fade, and the landing plays out in the chest, head, face and arms.
 */
function riseEntry(
  out: OneShotTemplate,
  N: number,
  F: (x: number) => number,
  u: number,
  T: (...keys: [number, number, number, KeyposeEase?][]) => void,
): void {
  const e = MOTION_PRIORS.entryRise,
    m = (stat: PriorStat) => stat.median,
    lag = m(e.headLagFrames);
  const key = <V>(frame: number, value: V, ease?: KeyposeEase): TemplateKey<V> => ({
    frame: Math.max(0, Math.min(N, frame)),
    value,
    ...(ease ? { ease } : {}),
  });
  const px = (hw: number) => r2(hw * u);
  T(
    [0, 0, m(e.startBelowHw)],
    [m(e.arriveAt), 0, -m(e.overshootHw), "out"],
    [m(e.sinkAt), 0, m(e.sinkHw), "sine"],
    [1, 0, 0, "sine"],
  );
  out.body = {
    tilt: [
      key(0, -m(e.startTiltDeg)),
      key(F(m(e.counterTiltAt)), m(e.counterTiltDeg), "out"),
      key(F(0.75), 0, "sine"),
    ],
    chest: [
      key(0, 0),
      key(F(m(e.chestStretchAt)), -px(m(e.chestStretchHw)), "out"),
      key(F(m(e.chestSquashAt)), px(m(e.chestSquashHw)), "sine"),
      key(N, 0, "sine"),
    ],
    head: [
      key(0, 0),
      key(F(m(e.chestStretchAt)) + lag, -px(m(e.headStretchHw)), "out"),
      key(F(m(e.chestSquashAt)) + lag, px(m(e.headSquashHw)), "sine"),
      key(N, 0, "sine"),
    ],
    face: [
      key(0, px(m(e.faceDownStartHw))),
      key(F(0.13), px(m(e.faceDownStartHw))),
      key(F(m(e.faceUpAt)), -px(m(e.faceUpHw)), "sine"),
      key(F(m(e.faceDownAt)), px(m(e.faceDownHw)), "sine"),
      key(N, 0, "sine"),
    ],
  };
  // Wrists in arm reaches; a hanging start and a flung peak are held inside the arm.
  const within = ([x, y]: [number, number]): [number, number] => {
    const d = Math.hypot(x, y),
      k = d > REACH_LIMIT ? REACH_LIMIT / d : 1,
      inward = (v: number) => Math.trunc(v * k * 100) / 100;
    return [inward(x), inward(y)];
  };
  const startOut = m(e.handStartOutReach);
  out.arms = [
    key<[number, number]>(0, within([startOut, Math.sqrt(REACH_LIMIT ** 2 - startOut ** 2)])),
    key<[number, number]>(
      F(m(e.handPeakAt)),
      within([m(e.handPeakOutReach), -m(e.handPeakAboveShoulderReach)]),
      "out",
    ),
    key<[number, number]>(
      F(m(e.handLowAt)),
      within([m(e.handLowOutReach), m(e.handLowBelowShoulderReach)]),
      "sine",
    ),
  ];
  // The arms are keyed above; strands keep the one-shot swing.
  out.swing = {
    limbDeg: 0,
    strandDeg: r2(MOTION_PRIORS.characterOneShot.strandDeg.median),
    tipLagFrames: MOTION_PRIORS.characterOneShot.strandTipLagFrames.median,
    period: N,
  };
  out.weak = true;
}
/** Keys collide on short animations: keep the last key per frame, in frame order. */
function dedupe(t: OneShotTemplate): OneShotTemplate {
  const last = <K extends { frame: number }>(keys: K[]) =>
    [...new Map(keys.map((k) => [k.frame, k])).values()].sort((a, b) => a.frame - b.frame);
  return {
    ...t,
    translate: last(t.translate),
    scale: last(t.scale),
    rotate: last(t.rotate),
    head: last(t.head),
    alpha: last(t.alpha),
    ...(t.body
      ? {
          body: {
            tilt: last(t.body.tilt),
            chest: last(t.body.chest),
            head: last(t.body.head),
            face: last(t.body.face),
          },
        }
      : {}),
    ...(t.arms ? { arms: last(t.arms) } : {}),
  };
}

/** Loop recipes (ADR-032) in plan terms, for a head width of `unit` px. */
export interface LoopRecipe {
  /** Main (hips) breath or bob depth, px. */
  depth: number;
  /** Translate follow of the head: `gain` times the main, `lag` frames later (0 = none). */
  head: { gain: number; lag: number };
  /** Strand roots swing ±`strandAmplitude` degrees with the main; tips `strandStep` frames per bone. */
  strandAmplitude: number;
  strandStep: number;
  /** Limb follow, ± degrees at full depth. */
  limbAmplitude: number;
  /** Seconds per main cycle (idle breath, walk stride), and main cycles per stride for a walk. */
  cycleSeconds: number;
  bobsPerCycle: number;
  /**
   * Free hands (idle only): `travel` times the main's travel relative to the body (ADR-019
   * `follow.travel`), `lag` frames behind, plus a bob of `twicePerBreath` px at twice the breath
   * rate (0 unless asked for), and `palmDeg` peak-to-peak palm turn. `weak` when it comes from
   * the one-art `idleHands` prior.
   */
  hand?: { travel: number; lag: number; twicePerBreath: number; palmDeg: number; weak: boolean };
}
/**
 * Idle: hips 0.06 hw; the head 0.7 x further, 8 frames later (1.6-2x the hips, about 3 frames
 * behind on a 2 s breath); strands ±8 degrees, tips 2 frames per bone; limbs ±2 degrees.
 * Free hands follow at travel 1, 2 frames late (ADR-019); `handBob` asks for the weak `idleHands`
 * prior instead: travel 2.6, 5 frames late, with a bob twice per breath.
 * Walk (one art): bob a third of a head width twice per stride. Prop: the base stays still.
 */
export function loopRecipe(
  kind: "idle" | "walk" | "prop",
  unit: number,
  options: { handBob?: boolean } = {},
): LoopRecipe {
  if (!(unit > 0) || !Number.isFinite(unit))
    failStage("animation", "PRIOR_UNIT", "A loop recipe needs a positive unit (px)");
  const P = MOTION_PRIORS,
    px = (hw: number) => +(hw * unit).toFixed(2);
  if (kind === "walk")
    return {
      depth: px(P.walk.bobHw.median),
      head: { gain: 0, lag: 0 },
      strandAmplitude: r2(P.walk.strandDeg.median / 2),
      strandStep: 2,
      limbAmplitude: r2(P.walk.limbDeg.median / 2),
      cycleSeconds: 4 / 3,
      bobsPerCycle: P.walk.bobsPerStride.median,
    };
  if (kind === "prop")
    return {
      depth: px(P.propLoop.baseHw.median),
      head: { gain: 0, lag: 0 },
      strandAmplitude: 0,
      strandStep: 0,
      limbAmplitude: 0,
      cycleSeconds: 2,
      bobsPerCycle: 1,
    };
  return {
    depth: px(+P.idle.pelvisHw.median.toFixed(2)),
    head: { gain: 0.7, lag: 8 },
    strandAmplitude: r2(P.idle.strandDeg.median / 2),
    strandStep: Math.round(P.idle.strandTipLagFrames.median / 2),
    limbAmplitude: 2,
    cycleSeconds: 2,
    bobsPerCycle: 1,
    hand: options.handBob
      ? {
          travel: P.idleHands.relTravelVsBody.median,
          lag: P.idleHands.lagFrames.median,
          twicePerBreath: px(P.idleHands.twicePerBreathHw.median),
          palmDeg: P.idleHands.palmDeg.median,
          weak: isWeakPrior("idleHands"),
        }
      : { travel: 1, lag: 2, twicePerBreath: 0, palmDeg: 0, weak: false },
  };
}

/** A clap loop (weak prior, one art) in plan terms, for a head width of `unit` px. */
export interface ClapRecipe {
  weak: boolean;
  /** Frames per clap, claps per body sway (one sway is the loop), and the contact frame in a beat. */
  beatFrames: number;
  beatsPerSway: number;
  contactFrame: number;
  /** Body lean (degrees) with the hands open and at contact, the head's extra lean, the dip (px). */
  leanOpenDeg: number;
  leanContactDeg: number;
  headLeanDeg: number;
  dip: number;
  /** Open hands: share of the arm's reach (at most 0.98) and degrees above the shoulder line. */
  open: { reach: number; aboveShoulderDeg: number };
  /** Contact: wrist to wrist (px) and how far below the shoulder line (px, positive is down). */
  contact: { gap: number; belowShoulder: number };
  palmTurnDeg: number;
}
export function clapRecipe(unit: number): ClapRecipe {
  if (!(unit > 0) || !Number.isFinite(unit))
    failStage("animation", "PRIOR_UNIT", "A clap recipe needs a positive unit (px)");
  const c = MOTION_PRIORS.clap,
    px = (hw: number) => +(hw * unit).toFixed(2),
    beat = c.beatFrames.median;
  return {
    weak: isWeakPrior("clap"),
    beatFrames: beat,
    beatsPerSway: c.beatsPerSway.median,
    contactFrame: Math.round(c.contactAtBeat.median * beat),
    leanOpenDeg: c.leanOpenDeg.median,
    leanContactDeg: c.leanContactDeg.median,
    headLeanDeg: c.headLeanDeg.median,
    dip: px(c.dipHw.median),
    open: {
      reach: Math.min(REACH_LIMIT, c.openReach.median),
      aboveShoulderDeg: c.openAboveShoulderDeg.median,
    },
    contact: { gap: px(c.contactGapHw.median), belowShoulder: px(c.contactBelowShoulderHw.median) },
    palmTurnDeg: c.palmTurnDeg.median,
  };
}
/** One arm for `clapPose`: the shoulder (IR px, y down) and the shoulder-to-wrist length (px). */
export interface ClapArm {
  shoulder: [number, number];
  reach: number;
}
export interface ClapPose {
  /** Lean side in [-1, 1] (+1: the first two claps) and how closed the hands are, 0 open..1 met. */
  sway: number;
  contact: number;
  /** Clockwise degrees: the body leans counter-clockwise first, as the artist's did. */
  leanDeg: number;
  headLeanDeg: number;
  /** The body's dip (px, y down) and each palm's turn toward the other hand (degrees). */
  dip: number;
  palmTurnDeg: number;
  /** Wrist targets (IR px, y down), from the shoulders given for this frame. */
  wrist: { l: [number, number]; r: [number, number] };
}
/**
 * The clap at `frame` of the loop. `l` is the arm on the image's left. Pass the shoulders as they
 * stand in that frame (after the lean) to keep the contact between them.
 */
export function clapPose(
  recipe: ClapRecipe,
  frame: number,
  arms: { l: ClapArm; r: ClapArm },
): ClapPose {
  const tau = 2 * Math.PI,
    period = recipe.beatFrames * recipe.beatsPerSway;
  const sway = Math.tanh(2.5 * Math.sin((tau * frame) / period)) / Math.tanh(2.5);
  const contact =
    (1 -
      Math.cos((tau * (frame - recipe.contactFrame + recipe.beatFrames / 2)) / recipe.beatFrames)) /
    2;
  const lean = recipe.leanOpenDeg + (recipe.leanContactDeg - recipe.leanOpenDeg) * contact;
  const [L, R] = [arms.l, arms.r];
  const mid: [number, number] = [
    (L.shoulder[0] + R.shoulder[0]) / 2,
    (L.shoulder[1] + R.shoulder[1]) / 2 + recipe.contact.belowShoulder,
  ];
  const up = (recipe.open.aboveShoulderDeg * Math.PI) / 180;
  const wrist = (arm: ClapArm, out: -1 | 1): [number, number] => {
    const reach = recipe.open.reach * arm.reach;
    const open: [number, number] = [
      arm.shoulder[0] + out * reach * Math.cos(up),
      arm.shoulder[1] - reach * Math.sin(up),
    ];
    const shut: [number, number] = [mid[0] + (out * recipe.contact.gap) / 2, mid[1]];
    return [
      r2(open[0] + (shut[0] - open[0]) * contact),
      r2(open[1] + (shut[1] - open[1]) * contact),
    ];
  };
  return {
    sway: r2(sway),
    contact: r2(contact),
    leanDeg: r2(-sway * lean),
    headLeanDeg: r2(-sway * recipe.headLeanDeg),
    dip: r2(recipe.dip * contact),
    palmTurnDeg: r2(recipe.palmTurnDeg * contact),
    wrist: { l: wrist(L, -1), r: wrist(R, 1) },
  };
}
