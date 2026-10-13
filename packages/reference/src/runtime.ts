import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import vm from "node:vm";

/**
 * The official spine-core 4.0 runtime (posing, constraints, mesh deform) loaded in Node.
 * Its ESM build uses extensionless imports, so the published IIFE bundle is evaluated instead,
 * inside a function so the bundle's top-level `var spine` stays local.
 */
interface SpineColor {
  r: number;
  g: number;
  b: number;
  a: number;
}
interface SpineBone {
  a: number;
  b: number;
  c: number;
  d: number;
  worldX: number;
  worldY: number;
  getWorldRotationX(): number;
}
export interface SpineAttachment {
  name: string;
  path?: string;
  color: SpineColor;
  worldVerticesLength: number;
  regionUVs: ArrayLike<number>;
  triangles: number[];
  computeWorldVertices(...args: unknown[]): void;
}
export interface SpineSlot {
  data: { name: string; index: number; blendMode: number };
  color: SpineColor;
  bone: SpineBone;
  getAttachment(): SpineAttachment | null;
}
interface SpineAnimation {
  name: string;
  duration: number;
  apply(...args: unknown[]): void;
}
export interface SpineSkeletonData {
  animations: SpineAnimation[];
  findAnimation(name: string): SpineAnimation | null;
  defaultSkin: SpineSkin;
  findSkin(name: string): SpineSkin | null;
}
export interface SpineSkin {
  getAttachment(slotIndex: number, name: string): SpineAttachment | null;
}
export interface SpineSkeleton {
  data: SpineSkeletonData;
  slots: SpineSlot[];
  drawOrder: SpineSlot[];
  setToSetupPose(): void;
  updateWorldTransform(): void;
  findSlot(name: string): SpineSlot | null;
  findBone(name: string): SpineBone | null;
  setSkin(skin: SpineSkin): void;
}
interface SpineModule {
  TextureRegion: new () => Record<string, unknown>;
  RegionAttachment: new (name: string) => Record<string, unknown>;
  MeshAttachment: new (name: string) => Record<string, unknown>;
  BoundingBoxAttachment: new (name: string) => unknown;
  PathAttachment: new (name: string) => unknown;
  PointAttachment: new (name: string) => unknown;
  ClippingAttachment: new (name: string) => unknown;
  SkeletonJson: new (loader: unknown) => { readSkeletonData(json: unknown): SpineSkeletonData };
  Skeleton: new (data: SpineSkeletonData) => SpineSkeleton;
  MixBlend: { setup: unknown };
  MixDirection: { mixIn: unknown };
}
let cached: SpineModule | undefined;
export function spineRuntime(): SpineModule {
  if (!cached) {
    const require = createRequire(import.meta.url);
    const dir = dirname(require.resolve("@esotericsoftware/spine-core/package.json"));
    const code = readFileSync(join(dir, "dist", "iife", "spine-core.js"), "utf8");
    cached = vm.runInThisContext(`(function () {\n${code}\nreturn spine;\n})()`, {
      filename: "spine-core.js",
    }) as SpineModule;
  }
  return cached;
}

export interface LoadedSkeleton {
  raw: Record<string, unknown>;
  data: SpineSkeletonData;
  skeleton: SpineSkeleton;
}
/** Loads a Spine 4.0 JSON document without textures (unit regions; geometry only). */
export function loadSkeleton(document: unknown): LoadedSkeleton {
  const spine = spineRuntime();
  const unitRegion = () => {
    const r = new spine.TextureRegion();
    Object.assign(r, {
      u: 0,
      v: 0,
      u2: 1,
      v2: 1,
      width: 1,
      height: 1,
      originalWidth: 1,
      originalHeight: 1,
      offsetX: 0,
      offsetY: 0,
      degrees: 0,
      rotate: false,
    });
    return r;
  };
  const loader = {
    newRegionAttachment(_skin: unknown, name: string, path: string) {
      const a = new spine.RegionAttachment(name);
      a.path = path;
      a.region = unitRegion();
      return a;
    },
    newMeshAttachment(_skin: unknown, name: string, path: string) {
      const a = new spine.MeshAttachment(name);
      a.path = path;
      a.region = unitRegion();
      return a;
    },
    newBoundingBoxAttachment: (_skin: unknown, name: string) =>
      new spine.BoundingBoxAttachment(name),
    newPathAttachment: (_skin: unknown, name: string) => new spine.PathAttachment(name),
    newPointAttachment: (_skin: unknown, name: string) => new spine.PointAttachment(name),
    newClippingAttachment: (_skin: unknown, name: string) => new spine.ClippingAttachment(name),
  };
  const raw = (typeof document === "string" ? JSON.parse(document) : document) as Record<
    string,
    unknown
  >;
  const data = new spine.SkeletonJson(loader).readSkeletonData(raw);
  const skeleton = new spine.Skeleton(data);
  skeleton.setToSetupPose();
  skeleton.updateWorldTransform();
  return { raw, data, skeleton };
}
/** Applies an animation at `time` over the setup pose (null = setup pose). */
export function pose(sk: LoadedSkeleton, animation: string | null, time: number): void {
  const spine = spineRuntime();
  sk.skeleton.setToSetupPose();
  if (animation) {
    const a = sk.data.findAnimation(animation);
    if (!a) throw new Error(`REFERENCE_ANIMATION: no animation ${animation}`);
    a.apply(sk.skeleton, 0, time, true, [], 1, spine.MixBlend.setup, spine.MixDirection.mixIn);
  }
  sk.skeleton.updateWorldTransform();
}
export const BLEND = { normal: 0, additive: 1, multiply: 2, screen: 3 } as const;
export interface DrawItem {
  slot: string;
  attachment: string;
  path: string;
  blend: number;
  color: [number, number, number, number];
  /** Spine world vertices (y up), interleaved. */
  verts: number[];
  uvs: number[];
  tris: number[];
}
/** Every visible region / mesh attachment in draw order, in the current pose. */
export function drawList(sk: LoadedSkeleton): DrawItem[] {
  const spine = spineRuntime() as unknown as {
    RegionAttachment: abstract new (...a: never[]) => unknown;
    MeshAttachment: abstract new (...a: never[]) => unknown;
  };
  const out: DrawItem[] = [];
  for (const slot of sk.skeleton.drawOrder) {
    const att = slot.getAttachment();
    if (!att) continue;
    const color: DrawItem["color"] = [
      slot.color.r * att.color.r,
      slot.color.g * att.color.g,
      slot.color.b * att.color.b,
      slot.color.a * att.color.a,
    ];
    if (color[3] <= 0.001) continue;
    let verts: number[], uvs: number[], tris: number[];
    if (att instanceof spine.RegionAttachment) {
      verts = new Array(8).fill(0);
      att.computeWorldVertices(slot.bone, verts, 0, 2);
      uvs = [0, 1, 0, 0, 1, 0, 1, 1]; // bottom-left, top-left, top-right, bottom-right
      tris = [0, 1, 2, 2, 3, 0];
    } else if (att instanceof spine.MeshAttachment) {
      verts = new Array(att.worldVerticesLength).fill(0);
      att.computeWorldVertices(slot, 0, att.worldVerticesLength, verts, 0, 2);
      uvs = Array.from(att.regionUVs);
      tris = att.triangles;
    } else continue;
    out.push({
      slot: slot.data.name,
      attachment: att.name,
      path: att.path ?? att.name,
      blend: slot.data.blendMode,
      color,
      verts,
      uvs,
      tris,
    });
  }
  return out;
}
