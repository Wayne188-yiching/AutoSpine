import { loadSkeleton } from "./runtime.js";

export interface StripReportRow {
  skin: string;
  slot: string;
  attachment: string;
  sourceType: string;
  outputType: "region" | "quad-mesh";
  image: string;
  width: number;
  height: number;
  shearCosine: number;
  fitResidualMaxPx: number;
  fitResidualRmsPx: number;
  meshVertexSamples: number;
}
export interface StripResult {
  document: Record<string, unknown>;
  report: {
    attachments: StripReportRow[];
    summary: {
      slots: number;
      attachments: number;
      fromMesh: number;
      fromRegion: number;
      maxResidualPx: number;
      over2px: string[];
      quadMeshForShear: string[];
      maxAbsShearCosine: number;
      skins: number;
      /** Clipping, bounding-box, point and path attachments: not images, so not kept. */
      droppedNonImage: string[];
      /** Image file not found: placed from the attachment's stored size; the path stays as authored. */
      missingImages: string[];
    };
  };
}
type Json = Record<string, unknown>;
type V2 = [number, number];

/** Least-squares affine dst = A * src + t. */
function fitAffine(src: V2[], dst: V2[]) {
  const n = src.length;
  let mx = 0,
    my = 0,
    nx = 0,
    ny = 0;
  for (let i = 0; i < n; i++) {
    mx += src[i]![0];
    my += src[i]![1];
    nx += dst[i]![0];
    ny += dst[i]![1];
  }
  mx /= n;
  my /= n;
  nx /= n;
  ny /= n;
  let sxx = 0,
    sxy = 0,
    syy = 0,
    uxx = 0,
    uxy = 0,
    uyx = 0,
    uyy = 0;
  for (let i = 0; i < n; i++) {
    const x = src[i]![0] - mx,
      y = src[i]![1] - my,
      u = dst[i]![0] - nx,
      v = dst[i]![1] - ny;
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
    uxx += u * x;
    uxy += u * y;
    uyx += v * x;
    uyy += v * y;
  }
  const det = sxx * syy - sxy * sxy;
  const inv = [syy / det, -sxy / det, -sxy / det, sxx / det];
  const A = [
    uxx * inv[0]! + uxy * inv[2]!,
    uxx * inv[1]! + uxy * inv[3]!,
    uyx * inv[0]! + uyy * inv[2]!,
    uyx * inv[1]! + uyy * inv[3]!,
  ] as [number, number, number, number];
  const t: V2 = [nx - (A[0] * mx + A[1] * my), ny - (A[2] * mx + A[3] * my)];
  return { A, t };
}

/**
 * Strips an official Spine 4.0 export down to images only: one root bone and every slot (order,
 * colour, blend), with each attachment placed where its image sits in the setup pose. A mesh's
 * placement is the least-squares affine of its UVs onto its setup world vertices; a placement that
 * shears becomes a bare 4-corner quad mesh. Bones, meshes, weights, constraints and animations go.
 * Every skin is kept under its own name (placed with that skin active, so skin bones count); linked
 * meshes are placed from their runtime vertices and UVs. Attachments that are not images (clipping,
 * bounding box, point, path) are dropped and listed in the report. When an image file is missing
 * (`imageSize` returns undefined), the attachment's own stored width/height places it and the report
 * lists it; without either it is dropped as `missing-image`.
 */
export function stripToImagesOnly(
  artist: unknown,
  imageSize: (path: string) => V2 | undefined,
): StripResult {
  const sk = loadSkeleton(artist);
  const raw = sk.raw as Json;
  const skeleton = (raw.skeleton ?? {}) as Json;
  const out: Json & {
    skins: { name: string; attachments: Record<string, Record<string, Json>> }[];
  } = {
    skeleton: {
      spine: "4.0.64",
      x: skeleton.x,
      y: skeleton.y,
      width: skeleton.width,
      height: skeleton.height,
      images: "./images/",
      audio: "",
    },
    bones: [{ name: "root" }],
    slots: [],
    skins: [],
    animations: {},
  };
  const rows: StripReportRow[] = [];
  const dropped: string[] = [],
    missingImages: string[] = [];
  for (const s of raw.slots as Json[]) {
    const slotOut: Json = { name: s.name, bone: "root" };
    for (const k of ["color", "dark", "attachment", "blend"])
      if (s[k] !== undefined) slotOut[k] = s[k];
    (out.slots as Json[]).push(slotOut);
  }
  for (const skinRaw of raw.skins as Json[]) {
    const skinName = skinRaw.name as string;
    const skin = sk.data.findSkin(skinName);
    if (!skin) throw new Error(`REFERENCE_SKIN: skin ${skinName} did not load`);
    sk.skeleton.setSkin(skin);
    sk.skeleton.setToSetupPose();
    sk.skeleton.updateWorldTransform();
    const skinOut = { name: skinName, attachments: {} as Record<string, Record<string, Json>> };
    out.skins.push(skinOut);
    for (const [slotName, atts] of Object.entries(
      skinRaw.attachments as Record<string, Record<string, Json>>,
    )) {
      const slot = sk.skeleton.findSlot(slotName)!;
      for (const [attName, a] of Object.entries(atts)) {
        const type = (a.type as string | undefined) ?? "region";
        if (["clipping", "boundingbox", "point", "path"].includes(type)) {
          dropped.push(`${skinName}/${slotName}/${attName}:${type}`);
          continue;
        }
        // A skin key is a placeholder: the attachment's `name` (then its `path`) picks the image.
        const path = (a.path as string | undefined) ?? (a.name as string | undefined) ?? attName;
        const found = imageSize(path),
          stored: V2 | undefined =
            typeof a.width === "number" && typeof a.height === "number"
              ? [a.width, a.height]
              : undefined;
        if (!found && !stored) {
          dropped.push(`${skinName}/${slotName}/${attName}:missing-image`);
          continue;
        }
        if (!found) missingImages.push(`${skinName}/${slotName}/${attName}:${path}`);
        const [w, h] = (found ?? stored)!;
        let fit: ReturnType<typeof fitAffine>,
          residualMax = 0,
          residualRms = 0,
          samples = 0;
        if (type === "region") {
          const bone = slot.bone;
          const r = (((a.rotation as number | undefined) ?? 0) * Math.PI) / 180,
            sx =
              (((a.scaleX as number | undefined) ?? 1) * ((a.width as number | undefined) ?? w)) /
              w,
            sy =
              (((a.scaleY as number | undefined) ?? 1) * ((a.height as number | undefined) ?? h)) /
              h;
          const cos = Math.cos(r),
            sin = Math.sin(r);
          const local = (px: number, py: number): V2 => {
            const lx = (px - w / 2) * sx,
              ly = (h / 2 - py) * sy;
            return [
              ((a.x as number | undefined) ?? 0) + lx * cos - ly * sin,
              ((a.y as number | undefined) ?? 0) + lx * sin + ly * cos,
            ];
          };
          const world = ([lx, ly]: V2): V2 => [
            bone.a * lx + bone.b * ly + bone.worldX,
            bone.c * lx + bone.d * ly + bone.worldY,
          ];
          const src: V2[] = [
            [0, 0],
            [w, 0],
            [w, h],
            [0, h],
            [w / 2, h / 2],
          ];
          fit = fitAffine(
            src,
            src.map((p) => world(local(p[0], p[1]))),
          );
        } else if (type === "mesh" || type === "linkedmesh") {
          const att = skin.getAttachment(
            (slot as unknown as { data: { index: number } }).data.index,
            attName,
          ) as unknown as {
            worldVerticesLength: number;
            regionUVs: ArrayLike<number>;
            computeWorldVertices: (...args: unknown[]) => void;
          };
          const n = att.worldVerticesLength / 2;
          const wv = new Array(att.worldVerticesLength).fill(0);
          att.computeWorldVertices(slot, 0, att.worldVerticesLength, wv, 0, 2);
          const uv = att.regionUVs;
          const src: V2[] = [],
            dst: V2[] = [];
          for (let i = 0; i < n; i++) {
            src.push([uv[2 * i]! * w, uv[2 * i + 1]! * h]);
            dst.push([wv[2 * i], wv[2 * i + 1]]);
          }
          fit = fitAffine(src, dst);
          let sq = 0;
          for (let i = 0; i < n; i++) {
            const px = fit.A[0] * src[i]![0] + fit.A[1] * src[i]![1] + fit.t[0],
              py = fit.A[2] * src[i]![0] + fit.A[3] * src[i]![1] + fit.t[1];
            const e = Math.hypot(px - dst[i]![0], py - dst[i]![1]);
            residualMax = Math.max(residualMax, e);
            sq += e * e;
          }
          residualRms = Math.sqrt(sq / n);
          samples = n;
        } else
          throw new Error(`REFERENCE_ATTACHMENT: unsupported ${type} in ${slotName}/${attName}`);
        const { A, t } = fit;
        // Columns: image +x and image up, in world (y up).
        const ex: V2 = [A[0], A[2]],
          eyUp: V2 = [-A[1], -A[3]];
        const rot = Math.atan2(ex[1], ex[0]);
        const scaleX = Math.hypot(ex[0], ex[1]);
        const perp: V2 = [-Math.sin(rot), Math.cos(rot)];
        const scaleY = eyUp[0] * perp[0] + eyUp[1] * perp[1];
        const shear = (ex[0] * eyUp[0] + ex[1] * eyUp[1]) / (scaleX * Math.hypot(eyUp[0], eyUp[1]));
        const centre: V2 = [
          A[0] * (w / 2) + A[1] * (h / 2) + t[0],
          A[2] * (w / 2) + A[3] * (h / 2) + t[1],
        ];
        const sheared = Math.abs(shear) > 0.01;
        let region: Json;
        if (sheared) {
          const corners = (
            [
              [0, 0],
              [w, 0],
              [w, h],
              [0, h],
            ] as V2[]
          ).map(([px, py]) => [A[0] * px + A[1] * py + t[0], A[2] * px + A[3] * py + t[1]]);
          region = {
            type: "mesh",
            uvs: [0, 0, 1, 0, 1, 1, 0, 1],
            triangles: [1, 2, 3, 1, 3, 0],
            vertices: corners.flat().map((v) => +v!.toFixed(2)),
            hull: 4,
            edges: [0, 2, 2, 4, 4, 6, 6, 0],
            width: w,
            height: h,
          };
        } else {
          region = {
            x: +centre[0].toFixed(2),
            y: +centre[1].toFixed(2),
            rotation: +((rot * 180) / Math.PI).toFixed(2),
            scaleX: +scaleX.toFixed(4),
            scaleY: +scaleY.toFixed(4),
            width: w,
            height: h,
          };
          if (region.rotation === 0) delete region.rotation;
          if (region.scaleX === 1) delete region.scaleX;
          if (region.scaleY === 1) delete region.scaleY;
        }
        if (path !== attName) region.path = path;
        if (a.color !== undefined) region.color = a.color;
        (skinOut.attachments[slotName] ??= {})[attName] = region;
        rows.push({
          skin: skinName,
          slot: slotName,
          attachment: attName,
          sourceType: type,
          outputType: sheared ? "quad-mesh" : "region",
          image: path,
          width: w,
          height: h,
          shearCosine: +shear.toFixed(5),
          fitResidualMaxPx: +residualMax.toFixed(2),
          fitResidualRmsPx: +residualRms.toFixed(2),
          meshVertexSamples: samples,
        });
      }
    }
  }
  return {
    document: out,
    report: {
      attachments: rows,
      summary: {
        slots: (out.slots as Json[]).length,
        attachments: rows.length,
        fromMesh: rows.filter((r) => r.sourceType === "mesh").length,
        fromRegion: rows.filter((r) => r.sourceType === "region").length,
        maxResidualPx: Math.max(0, ...rows.map((r) => r.fitResidualMaxPx)),
        over2px: rows
          .filter((r) => r.fitResidualMaxPx > 2)
          .map((r) => `${r.attachment}:${r.fitResidualMaxPx}`),
        quadMeshForShear: rows.filter((r) => r.outputType === "quad-mesh").map((r) => r.attachment),
        maxAbsShearCosine: Math.max(0, ...rows.map((r) => Math.abs(r.shearCosine))),
        skins: out.skins.length,
        droppedNonImage: dropped,
        missingImages,
      },
    },
  };
}
