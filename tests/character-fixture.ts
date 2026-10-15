import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PNG } from "pngjs";
import type { CharacterPlan } from "@autospine/schemas";
import { readImagesOnlyLayout } from "@autospine/spine";
import type { CharacterLayout, CharacterPart } from "@autospine/character";

/**
 * A small synthetic character for the plan / reference tests (ADR-017): hair strand, two legs,
 * body, one arm, a round head with a face dome and an eye strip. Every image is drawn here, so
 * the fixture carries no private art.
 */
interface Image {
  width: number;
  height: number;
  /** Spine world centre (y up). */
  x: number;
  y: number;
  color: [number, number, number];
  inside: (u: number, v: number) => boolean;
}
const ellipse = (u: number, v: number) => (2 * u - 1) ** 2 + (2 * v - 1) ** 2 <= 1;
const capsule = (w: number, h: number) => (u: number, v: number) => {
  const px = u * w,
    py = v * h,
    r = w / 2,
    cy = Math.min(Math.max(py, r), h - r);
  return (px - r) ** 2 + (py - cy) ** 2 <= r * r;
};
export const FIXTURE_IMAGES: Record<string, Image> = {
  Hair: { width: 24, height: 140, x: 30, y: 230, color: [90, 60, 140], inside: capsule(24, 140) },
  Leg_L: {
    width: 22,
    height: 110,
    x: -15,
    y: 55,
    color: [240, 200, 180],
    inside: capsule(22, 110),
  },
  Leg_R: { width: 22, height: 110, x: 15, y: 55, color: [240, 200, 180], inside: capsule(22, 110) },
  Body: { width: 70, height: 120, x: 0, y: 160, color: [80, 140, 220], inside: capsule(70, 120) },
  Arm_R: { width: 16, height: 90, x: 38, y: 165, color: [235, 195, 175], inside: capsule(16, 90) },
  Head: { width: 80, height: 80, x: 0, y: 255, color: [245, 210, 190], inside: ellipse },
  Eyes: {
    width: 40,
    height: 12,
    x: 0,
    y: 258,
    color: [30, 30, 60],
    inside: (u, v) =>
      ((u - 0.2) * 40) ** 2 + ((v - 0.5) * 12) ** 2 <= 25 ||
      ((u - 0.8) * 40) ** 2 + ((v - 0.5) * 12) ** 2 <= 25,
  },
};
export const FIXTURE_ORDER = Object.keys(FIXTURE_IMAGES);

export function fixtureRgba(name: string): { width: number; height: number; rgba: Uint8Array } {
  const im = FIXTURE_IMAGES[name]!;
  const rgba = new Uint8Array(im.width * im.height * 4);
  for (let y = 0; y < im.height; y++)
    for (let x = 0; x < im.width; x++) {
      if (!im.inside((x + 0.5) / im.width, (y + 0.5) / im.height)) continue;
      const i = (y * im.width + x) * 4;
      rgba.set([...im.color, 255], i);
    }
  return { width: im.width, height: im.height, rgba };
}

const hash = (i: number, j: number) => {
  let n = (i * 374761393 + j * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
const noise = (x: number, y: number) => {
  const i = Math.floor(x / 4),
    j = Math.floor(y / 4),
    fx = x / 4 - i,
    fy = y / 4 - j;
  const top = hash(i, j) * (1 - fx) + hash(i + 1, j) * fx,
    bottom = hash(i, j + 1) * (1 - fx) + hash(i + 1, j + 1) * fx;
  return top * (1 - fy) + bottom * fy;
};
/**
 * The fixture's images with texture, for pose fitting (ADR-024): flat colours would match anywhere
 * inside a same-coloured part. Value noise in 4 px cells is fine and not periodic, so one placement
 * matches; each image has its own noise, as separate drawings do (two equal legs side by side
 * would match each other). Same sizes and alpha as `fixtureRgba`.
 */
export function fixtureTextures(): Map<
  string,
  { width: number; height: number; rgba: Uint8Array }
> {
  return new Map(
    Object.entries(FIXTURE_IMAGES).map(([name, im], n) => {
      const rgba = new Uint8Array(im.width * im.height * 4);
      for (let y = 0; y < im.height; y++)
        for (let x = 0; x < im.width; x++) {
          if (!im.inside((x + 0.5) / im.width, (y + 0.5) / im.height)) continue;
          const k = 0.35 + 0.65 * noise(x + 97 * n, y + 53 * n);
          rgba.set(
            [im.color[0] * k, im.color[1] * (1.2 - k / 2), im.color[2] * k, 255],
            (y * im.width + x) * 4,
          );
        }
      return [name, { width: im.width, height: im.height, rgba }];
    }),
  );
}

/** The images-only Spine 4.0 document: one root bone, one region per slot. */
export function fixtureImagesOnly() {
  return {
    skeleton: {
      hash: "fixture",
      spine: "4.0.64",
      x: -60,
      y: -5,
      width: 120,
      height: 310,
      images: "./images/",
    },
    bones: [{ name: "root" }],
    slots: FIXTURE_ORDER.map((name) => ({ name, bone: "root", attachment: name })),
    skins: [
      {
        name: "default",
        attachments: Object.fromEntries(
          FIXTURE_ORDER.map((name) => {
            const im = FIXTURE_IMAGES[name]!;
            return [name, { [name]: { x: im.x, y: im.y, width: im.width, height: im.height } }];
          }),
        ),
      },
    ],
    animations: {},
  };
}

/** The layout the CLI would load from the images-only document and its PNGs. */
export function fixtureLayout(): CharacterLayout {
  const read = readImagesOnlyLayout(fixtureImagesOnly());
  const parts = new Map<string, CharacterPart>();
  for (const a of read.attachments) {
    const { width, height, rgba } = fixtureRgba(a.path);
    const alpha = new Uint8Array(width * height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3]!;
    parts.set(a.key, { ...a, alpha });
  }
  return { slots: read.slots, parts, skeleton: read.skeleton };
}

export function fixturePlan(): CharacterPlan {
  return {
    schemaVersion: "0.1",
    kind: "character-plan",
    id: "fixture_character",
    name: "Fixture character",
    source: { imagesOnly: "imagesOnly.json", images: "images" },
    artAngle: 0,
    joints: {
      pelvis: { rule: "end", part: "Body", dir: [0, 1], band: 10 },
      neck: { rule: "overlap", parts: ["Body", "Head"] },
      // A round part has no principal axis: use "end" with a direction, not "axisEnd".
      headTop: { rule: "end", part: "Head", dir: [0, -1], band: 8 },
      faceAnchor: { rule: "centroid", part: "Eyes" },
      shoulderR: { rule: "axisEnd", part: "Arm_R", pick: "top" },
      handR: { rule: "axisEnd", part: "Arm_R", pick: "far", ref: "shoulderR" },
      elbowR: { rule: "lerp", a: "shoulderR", b: "handR", t: 0.5 },
      hipL: { rule: "axisEnd", part: "Leg_L", pick: "top" },
      footL: { rule: "axisEnd", part: "Leg_L", pick: "bottom" },
      kneeL: { rule: "lerp", a: "hipL", b: "footL", t: 0.5 },
      ankleL: { rule: "narrowest", part: "Leg_L", a: "hipL", b: "footL", range: [0.8, 0.95] },
      hipR: { rule: "axisEnd", part: "Leg_R", pick: "top" },
      footR: { rule: "axisEnd", part: "Leg_R", pick: "bottom" },
      kneeR: { rule: "lerp", a: "hipR", b: "footR", t: 0.5 },
      ankleR: { rule: "lerp", a: "hipR", b: "footR", t: 0.88 },
    },
    bones: [
      { id: "root", at: { rule: "point", at: [0, 0] }, angle: 0 },
      { id: "hips", parent: "root", at: "pelvis", angle: -90, length: 20 },
      { id: "spine", parent: "hips", at: "pelvis", to: "neck" },
      { id: "head", parent: "spine", at: "neck", to: "headTop" },
      { id: "face_base", parent: "head", at: "faceAnchor", angle: "art", length: 12 },
      { id: "face_ctl", parent: "face_base", at: "faceAnchor", angle: "art", length: 12 },
      { id: "face_counter", parent: "face_base", at: "faceAnchor", angle: "art", length: 6 },
      { id: "eyes", parent: "head", at: "faceAnchor", angle: "art", length: 8 },
      { chain: { part: "Hair", bones: 3, parent: "head", from: "top", prefix: "hair" } },
      { id: "arm_r", parent: "spine", at: "shoulderR", to: "elbowR" },
      { id: "forearm_r", parent: "arm_r", at: "elbowR", to: "handR" },
      { id: "thigh_l", parent: "hips", at: "hipL", to: "kneeL" },
      { id: "calf_l", parent: "thigh_l", at: "kneeL", to: "ankleL" },
      { id: "foot_l", parent: "calf_l", at: "ankleL", to: "footL" },
      { id: "thigh_r", parent: "hips", at: "hipR", to: "kneeR" },
      { id: "calf_r", parent: "thigh_r", at: "kneeR", to: "ankleR" },
      { id: "foot_r", parent: "calf_r", at: "ankleR", to: "footR" },
    ],
    face: {
      head: "Head",
      anchor: "faceAnchor",
      base: "face_base",
      control: "face_ctl",
      counter: "face_counter",
      followers: ["eyes"],
    },
    meshes: [
      {
        part: "Hair",
        mesh: { type: "surface", cols: 2, rows: 10 },
        weights: { type: "chain", chain: "Hair" },
      },
      {
        part: "Leg_L",
        mesh: { type: "contour" },
        weights: { type: "chain", bones: ["thigh_l", "calf_l", "foot_l"] },
      },
      {
        part: "Leg_R",
        mesh: { type: "contour" },
        weights: { type: "chain", bones: ["thigh_r", "calf_r", "foot_r"] },
      },
      {
        part: "Body",
        mesh: { type: "contour" },
        weights: { type: "gradient", from: "spine", to: "head" },
      },
      {
        part: "Arm_R",
        mesh: { type: "contour" },
        weights: { type: "chain", bones: ["arm_r", "forearm_r"] },
      },
      { part: "Head", mesh: { type: "feature" }, weights: { type: "dome" } },
    ],
    regions: { Eyes: "eyes" },
    motion: {
      cycle: 40,
      fps: 30,
      params: {
        up: 8,
        down: 16,
        hold: 6,
        rise: 2,
        depth: 5,
        lag: 2,
        gHead: 0.4,
        amp: 4,
        gHair: 0.5,
        peak: 12,
        grow: 0.3,
        step: 4,
        armAmp: 3,
      },
      search: {
        lag: { min: 0, max: 6, step: 1, integer: true },
        gHead: { min: -2, max: 2, step: 0.25 },
        amp: { min: 0, max: 10, step: 1 },
        peak: { min: 0, max: 39, step: 4, integer: true, cyclic: true },
      },
      animations: [{ name: "IDLE", frames: 80, cycleScale: [1, 0.8] }],
      main: {
        id: "body",
        bone: "hips",
        channel: "translate",
        up: "$up",
        down: "$down",
        hold: "$hold",
        rise: "$rise",
        depth: "$depth",
      },
      beats: [
        {
          id: "elbow",
          bone: "forearm_r",
          channel: "rotate",
          rest: 0,
          up: 2,
          down: -4,
          hold: -5,
          scaleUp: true,
        },
      ],
      sink: [
        {
          kind: "legs",
          legs: [
            { side: "L", thigh: "thigh_l", calf: "calf_l", foot: "foot_l" },
            { side: "R", thigh: "thigh_r", calf: "calf_r", foot: "foot_r" },
          ],
        },
        { kind: "face", id: "face", bone: "face_ctl", channel: "translate", y: 2, x: 0.5 },
      ],
      follow: [{ id: "headF", bone: "head", channel: "rotate", gain: "$gHead", lag: "=$lag+1" }],
      waves: [
        {
          chain: "Hair",
          amp: "$amp",
          rootGain: "$gHair",
          peak: "$peak",
          growth: "$grow",
          step: "$step",
        },
      ],
      cycles: [
        {
          id: "armC",
          bone: "arm_r",
          channel: "rotate",
          amplitude: "$armAmp",
          period: "animation",
          phaseFraction: 0.25,
        },
      ],
      keyed: [
        {
          id: "look",
          bone: "eyes",
          channel: "translate",
          rest: [0, 0],
          keys: {
            IDLE: [
              { frame: 20, value: [1, 0], ease: "sine" },
              { frame: 60, value: [-1, 0], ease: "sine" },
            ],
          },
        },
      ],
    },
    qa: {
      seams: [
        ["Body", "Head"],
        ["Body", "Arm_R"],
        ["Body", "Leg_L"],
        ["Body", "Leg_R"],
      ],
      probes: {
        face: "Head",
        eyes: "Eyes",
        chain: [
          ["body", "Body"],
          ["head", "Head"],
          ["hair", "Hair"],
        ],
        hand: ["hand_r", "Arm_R"],
      },
    },
  };
}

function png(name: string): Buffer {
  const { width, height, rgba } = fixtureRgba(name);
  const out = new PNG({ width, height });
  out.data.set(rgba);
  return PNG.sync.write(out);
}
/** A workspace with plan.json, imagesOnly.json and images/*.png, as the CLI and MCP read them. */
export async function fixtureWorkspace(): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), "autospine-character-"));
  await mkdir(join(dir, "images"));
  for (const name of FIXTURE_ORDER) await writeFile(join(dir, "images", `${name}.png`), png(name));
  await writeFile(join(dir, "imagesOnly.json"), JSON.stringify(fixtureImagesOnly()));
  await writeFile(join(dir, "plan.json"), JSON.stringify(fixturePlan()));
  return dir;
}
