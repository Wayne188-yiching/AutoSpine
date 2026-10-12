import { failStage, type Affine } from "@autospine/rig";

/** One placed image of an images-only Spine 4.0 document. */
export interface ImagesOnlyAttachment {
  slot: string;
  attachment: string;
  /** Slot name for the setup attachment, otherwise `slot#attachment`. */
  key: string;
  path: string;
  setup: boolean;
  order: number;
  width: number;
  height: number;
  /** Pixel (x right, y down from the image's top-left) to IR world (x right, y down). */
  affine: Affine;
  /** Placed as a 4-corner quad mesh because the placement shears. */
  sheared: boolean;
  color?: string;
}
export interface ImagesOnlyLayout {
  slots: {
    name: string;
    index: number;
    attachment?: string;
    color?: string;
    dark?: string;
    blend?: "normal" | "additive" | "multiply" | "screen";
    attachments: string[];
  }[];
  attachments: ImagesOnlyAttachment[];
  skeleton: { x?: number; y?: number; width?: number; height?: number };
}
type Json = Record<string, unknown>;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Reads the layout of an images-only document (one root bone; every attachment a region, or a
 * bare 4-corner quad mesh for sheared placements) as produced by `stripToImagesOnly`.
 */
export function readImagesOnlyLayout(document: unknown): ImagesOnlyLayout {
  const fail = (reason: string): never => failStage("spine", "IMAGES_ONLY_LAYOUT", reason);
  const doc = document as Json;
  const bones = doc.bones as Json[] | undefined;
  if (
    !Array.isArray(bones) ||
    bones.length !== 1 ||
    bones[0]?.name !== "root" ||
    Object.keys(bones[0]!).length !== 1
  )
    fail("An images-only document has exactly one untransformed root bone");
  const slotsRaw = doc.slots as Json[] | undefined;
  const skins = doc.skins as Json[] | undefined;
  if (!Array.isArray(slotsRaw) || !Array.isArray(skins) || skins.length !== 1)
    fail("Slots and exactly one (default) skin are required");
  const atts = (skins![0]!.attachments ?? {}) as Record<string, Record<string, Json>>;
  const layout: ImagesOnlyLayout = { slots: [], attachments: [], skeleton: {} };
  const sk = (doc.skeleton ?? {}) as Json;
  for (const k of ["x", "y", "width", "height"] as const)
    if (isNum(sk[k])) layout.skeleton[k] = sk[k];
  slotsRaw!.forEach((s, index) => {
    const name = s.name as string;
    if (typeof name !== "string" || s.bone !== "root") fail(`Slot ${String(name)} must be on root`);
    const own = atts[name] ?? {};
    layout.slots.push({
      name,
      index,
      ...(typeof s.attachment === "string" ? { attachment: s.attachment } : {}),
      ...(typeof s.color === "string" ? { color: s.color } : {}),
      ...(typeof s.dark === "string" ? { dark: s.dark } : {}),
      ...(typeof s.blend === "string"
        ? { blend: s.blend as ImagesOnlyLayout["slots"][number]["blend"] }
        : {}),
      attachments: Object.keys(own),
    });
    for (const [attName, a] of Object.entries(own)) {
      if (!isNum(a.width) || !isNum(a.height) || a.width <= 0 || a.height <= 0)
        fail(`${name}/${attName} needs its image width and height`);
      const w = a.width as number,
        h = a.height as number;
      const sheared = a.type === "mesh";
      if (a.type !== undefined && a.type !== "region" && !sheared)
        fail(`${name}/${attName}: only regions and quads`);
      let affine: Affine;
      if (sheared) {
        const v = a.vertices as number[];
        if (!Array.isArray(v) || v.length !== 8 || !v.every(isNum))
          fail(`${name}/${attName}: a quad has 4 root-space corners`);
        // Corners (0,0), (w,0), (w,h), (0,h) of the image, in Spine world (y up).
        const p0 = [v[0]!, -v[1]!],
          p1 = [v[2]!, -v[3]!],
          p3 = [v[6]!, -v[7]!];
        affine = [
          (p1[0]! - p0[0]!) / w,
          (p1[1]! - p0[1]!) / w,
          (p3[0]! - p0[0]!) / h,
          (p3[1]! - p0[1]!) / h,
          p0[0]!,
          p0[1]!,
        ];
      } else {
        const r = (((a.rotation as number | undefined) ?? 0) * Math.PI) / 180,
          sx = (a.scaleX as number | undefined) ?? 1,
          sy = (a.scaleY as number | undefined) ?? 1,
          x = (a.x as number | undefined) ?? 0,
          y = (a.y as number | undefined) ?? 0;
        const cos = Math.cos(r),
          sin = Math.sin(r);
        // Spine local (y up, centred) -> world, then IR y = -Y.
        affine = [
          sx * cos,
          -(sx * sin),
          sy * sin,
          sy * cos,
          x - (w / 2) * sx * cos - (h / 2) * sy * sin,
          -(y - (w / 2) * sx * sin + (h / 2) * sy * cos),
        ];
      }
      const setup = attName === s.attachment;
      layout.attachments.push({
        slot: name,
        attachment: attName,
        key: setup ? name : `${name}#${attName}`,
        path: typeof a.path === "string" ? a.path : attName,
        setup,
        order: index,
        width: w,
        height: h,
        affine,
        sheared,
        ...(typeof a.color === "string" ? { color: a.color } : {}),
      });
    }
  });
  return layout;
}
