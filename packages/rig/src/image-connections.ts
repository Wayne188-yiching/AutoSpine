import {
  analyzeImageRegions,
  type ImageRegionInput,
  type ImageRegionEvidence,
} from "./image-regions.js";

/** Image-space end cues only. Width and clipping do not establish a joint or parent. */
export function analyzeImageConnections(input: ImageRegionInput) {
  const evidence = analyzeImageRegions(input);
  const { width, height, rgba } = input;
  const visited = new Uint8Array(width * height);
  const queue = new Uint32Array(width * height);
  const regions = [];
  for (let seed = 0; seed < visited.length; seed++) {
    if (visited[seed] || !rgba[seed * 4 + 3]) continue;
    let head = 0,
      tail = 1;
    queue[0] = seed;
    visited[seed] = 1;
    const borderContacts = { left: 0, right: 0, top: 0, bottom: 0 };
    const add = (p: number) => {
      if (!visited[p] && rgba[p * 4 + 3]! > 0) {
        visited[p] = 1;
        queue[tail++] = p;
      }
    };
    while (head < tail) {
      const p = queue[head++]!,
        x = p % width,
        y = Math.floor(p / width);
      if (x === 0) borderContacts.left++;
      else add(p - 1);
      if (x === width - 1) borderContacts.right++;
      else add(p + 1);
      if (y === 0) borderContacts.top++;
      else add(p - width);
      if (y === height - 1) borderContacts.bottom++;
      else add(p + width);
    }
    const region: ImageRegionEvidence = evidence.regions[regions.length]!;
    let endCandidates: { center: [number, number]; pixels: number; transverseSpan: number }[] = [];
    let widerEndHint: number | null = null;
    if (tail >= 32 && region.anisotropy >= 0.6) {
      const [cx, cy] = region.centroid;
      let xx = 0,
        xy = 0,
        yy = 0;
      for (let i = 0; i < tail; i++) {
        const p = queue[i]!,
          x = (p % width) + 0.5 - cx,
          y = Math.floor(p / width) + 0.5 - cy;
        xx += x * x;
        xy += x * y;
        yy += y * y;
      }
      const angle = Math.atan2(2 * xy, xx - yy) / 2,
        ux = Math.cos(angle),
        uy = Math.sin(angle);
      let min = Infinity,
        max = -Infinity;
      for (let i = 0; i < tail; i++) {
        const p = queue[i]!,
          projection = ((p % width) + 0.5 - cx) * ux + (Math.floor(p / width) + 0.5 - cy) * uy;
        min = Math.min(min, projection);
        max = Math.max(max, projection);
      }
      const caps = [0, 1].map(() => ({ x: 0, y: 0, pixels: 0, min: Infinity, max: -Infinity }));
      for (let i = 0; i < tail; i++) {
        const p = queue[i]!,
          x = (p % width) + 0.5,
          y = Math.floor(p / width) + 0.5;
        const projection = (x - cx) * ux + (y - cy) * uy;
        const transverse = -(x - cx) * uy + (y - cy) * ux;
        const side =
          projection <= min + (max - min) * 0.15
            ? 0
            : projection >= max - (max - min) * 0.15
              ? 1
              : null;
        if (side !== null) {
          const cap = caps[side]!;
          cap.x += x;
          cap.y += y;
          cap.pixels++;
          cap.min = Math.min(cap.min, transverse);
          cap.max = Math.max(cap.max, transverse);
        }
      }
      endCandidates = caps.map((cap) => ({
        center: [cap.x / cap.pixels, cap.y / cap.pixels],
        pixels: cap.pixels,
        transverseSpan: cap.max - cap.min + 1,
      }));
      if (caps.every((cap) => cap.pixels >= 4)) {
        const a = endCandidates[0]!.transverseSpan,
          b = endCandidates[1]!.transverseSpan;
        if (a >= b * 1.5) widerEndHint = 0;
        if (b >= a * 1.5) widerEndHint = 1;
      }
    }
    regions.push({
      regionId: region.id,
      pixels: tail,
      anisotropy: region.anisotropy,
      borderContacts,
      endCandidates,
      widerEndHint,
      joint: null,
      parent: null,
      reasons: [
        ...(endCandidates.length ? ["UNDIRECTED_END_CANDIDATES"] : ["NO_ELONGATED_REGION_CUE"]),
        ...(widerEndHint !== null ? ["WIDER_CAP_IS_NOT_A_VERIFIED_ROOT"] : []),
        ...(Object.values(borderContacts).some((n) => n > 0)
          ? ["IMAGE_BORDER_CONTACT_IS_NOT_A_VERIFIED_CUT"]
          : []),
        "ASSEMBLY_POSE_UNAVAILABLE",
        "JOINT_UNDETERMINED",
      ],
    });
  }
  return {
    schemaVersion: "0.1",
    kind: "image-connection-evidence",
    width,
    height,
    policy: {
      minimumPixels: 32,
      minimumAnisotropy: 0.6,
      capFraction: 0.15,
      widerCapRatio: 1.5,
      calibrated: false,
    },
    foregroundPixels: evidence.foregroundPixels,
    regions,
    selectedRegion: null,
    pivot: null,
    boneCount: null,
    qualityAccepted: false,
    status: "REVIEW_REQUIRED",
    reasons: [
      ...(regions.length > 1 ? ["REGION_SELECTION_UNDETERMINED"] : []),
      "ROLE_REQUIRES_SEPARATE_VISUAL_REVIEW",
      "PARENT_AND_JOINT_UNDETERMINED",
    ],
  } as const;
}
