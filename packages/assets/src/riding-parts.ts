import type { AssetPart } from "@autospine/schemas";
import { failStage } from "@autospine/rig";

/**
 * A rider (`target`) and the part it follows (`source`). "Riding" is the glow/outline relation
 * from ADR-013: the rider has no rig of its own and takes its weights from the base part's mesh.
 * `target` is the decorative layer; `source` is the body underneath it.
 */
export interface RidingMatch {
  target: string;
  source: string;
  reason: "explicit" | "name" | "overlap";
  /** 1 for `explicit`/`name`; the bbox IoU for `overlap`. */
  score: number;
}

export interface RidingOptions {
  /**
   * Name suffixes a rider's name may carry over its base's name ("halos" over "halo"). Stripping
   * is data, not a hardwired convention: a project with a different (or non-English) naming scheme
   * passes its own list. Compared case-sensitively; order is the trial order.
   */
  suffixes?: string[];
  /** Roles treated as riders when no `rides` is declared. */
  riderRoles?: string[];
  /** Minimum bbox IoU for an `overlap` match, dimensionless. Below it, no pair is emitted. */
  minOverlap?: number;
}

const DEFAULT_SUFFIXES = ["s"];
const DEFAULT_RIDER_ROLES = ["glow"];
/**
 * Conservative non-zero floor: two parts that barely graze each other are not evidence of a glow
 * sitting on a body. Dimensionless so it transfers across canvas sizes; raise it per project
 * rather than relying on it to be correct.
 */
const DEFAULT_MIN_OVERLAP = 0.1;

function iou(a: AssetPart["bounds"], b: AssetPart["bounds"]): number {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = x * y;
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Pairs riders with their base parts. Rules in order, first that resolves wins:
 *   1. `explicit` — the rider's `rides` field names the base outright.
 *   2. `name` — the rider's name minus one configured suffix equals a base part's name.
 *   3. `overlap` — largest world-bbox IoU above `minOverlap`.
 *
 * Only parts that are *declared* riders are considered: a part with `rides`, or a part whose
 * `role` is in `riderRoles`. Overlap is never used to discover riders, only to find the base of a
 * part already known to be one — pixel/bbox evidence does not assign meaning here either.
 *
 * Deterministic: candidates are processed in `parts` order, output is sorted by target id, and
 * ties (equal IoU, or several names stripping to the same base) are broken by the smaller source
 * part id in ascending code-unit order. A candidate with no resolvable base is simply omitted.
 */
export function matchRidingParts(
  parts: readonly AssetPart[],
  options: RidingOptions = {},
): RidingMatch[] {
  const {
    suffixes = DEFAULT_SUFFIXES,
    riderRoles = DEFAULT_RIDER_ROLES,
    minOverlap = DEFAULT_MIN_OVERLAP,
  } = options;
  if (
    !Array.isArray(parts) ||
    parts.length > 4096 ||
    !Array.isArray(suffixes) ||
    suffixes.some((s) => typeof s !== "string" || s.length === 0 || s.length > 32) ||
    !Array.isArray(riderRoles) ||
    riderRoles.some((r) => typeof r !== "string" || r.length === 0) ||
    !Number.isFinite(minOverlap) ||
    minOverlap < 0 ||
    minOverlap > 1
  )
    failStage(
      "asset",
      "RIDING_OPTIONS",
      "Bounded parts, suffix list and overlap threshold required",
    );
  const byId = new Map(parts.map((part) => [part.id, part]));
  if (byId.size !== parts.length) failStage("asset", "RIDING_PART_IDS", "Part ids must be unique");
  const riderRoleSet = new Set(riderRoles);
  const matches: RidingMatch[] = [];
  for (const part of parts) {
    const isRider =
      part.rides !== undefined || (part.role !== undefined && riderRoleSet.has(part.role));
    if (!isRider) continue;
    if (part.rides !== undefined) {
      // An explicit reference to a missing or self part is an authoring error, not a near miss.
      if (part.rides === part.id || !byId.has(part.rides))
        failStage("asset", "RIDING_UNRESOLVED", `Part ${part.id} rides an unknown part`);
      matches.push({ target: part.id, source: part.rides, reason: "explicit", score: 1 });
      continue;
    }
    const named = suffixes
      .flatMap((suffix) =>
        part.name.length > suffix.length && part.name.endsWith(suffix)
          ? [part.name.slice(0, part.name.length - suffix.length)]
          : [],
      )
      .flatMap((base) => parts.filter((p) => p.id !== part.id && p.name === base))
      .map((p) => p.id)
      .sort();
    if (named.length) {
      matches.push({ target: part.id, source: named[0]!, reason: "name", score: 1 });
      continue;
    }
    let best: { id: string; score: number } | undefined;
    for (const other of parts) {
      if (other.id === part.id) continue;
      const score = iou(part.bounds, other.bounds);
      if (score < minOverlap) continue;
      if (!best || score > best.score || (score === best.score && other.id < best.id))
        best = { id: other.id, score };
    }
    if (best)
      matches.push({ target: part.id, source: best.id, reason: "overlap", score: best.score });
  }
  return matches.sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0));
}
