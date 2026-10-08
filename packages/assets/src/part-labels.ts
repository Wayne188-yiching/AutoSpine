import { Value } from "@sinclair/typebox/value";
import {
  AssetSpecSchema,
  PartLabelMapSchema,
  PART_LABEL_PATTERN_MAX_LENGTH,
  type AssetPart,
  type AssetSpec,
  type PartLabelMap,
  type PartLabelPattern,
  type PartRole,
  type PartSide,
} from "@autospine/schemas";
import { failStage } from "@autospine/rig";

/** Where a part's role came from, so a caller can audit every assignment. */
export type PartLabelSource = "pattern" | "override" | "unlabelled";

export interface PartLabelAssignment {
  partId: string;
  role: PartRole;
  side?: PartSide;
  rides?: string;
  source: PartLabelSource;
  /** Index into `labels.patterns` when `source` is "pattern"; absent otherwise. */
  patternIndex?: number;
}

/**
 * Structural limits on an authored regular expression, applied on top of the schema's length cap.
 * The goal is not to decide "is this regex safe" in general, only to reject the shapes that make
 * backtracking blow up on caller-supplied input: many quantifiers, deep nesting, and a quantified
 * group whose body is itself quantified (`(a+)+`). Conservative on purpose; a rule that trips it
 * can always be split into two patterns or an override.
 */
const MAX_QUANTIFIERS = 16;
const MAX_GROUP_DEPTH = 4;

function isQuantifier(source: string, index: number): boolean {
  const c = source[index];
  return c === "*" || c === "+" || c === "{";
}

/** Walks the source once, skipping escapes and character classes, and fails on the shapes above. */
function assertSafePatternSource(source: string, patternIndex: number): void {
  if (source.length > PART_LABEL_PATTERN_MAX_LENGTH)
    failStage(
      "asset",
      "PART_LABEL_PATTERN_LENGTH",
      `Pattern ${patternIndex} exceeds the length cap`,
    );
  let quantifiers = 0,
    depth = 0,
    maxDepth = 0,
    inClass = false;
  // Quantifier count per open group, so a quantified group can be checked for a quantified body.
  const groupQuantifiers: number[] = [];
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (c === "\\") {
      i++;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      continue;
    }
    if (c === "[") {
      inClass = true;
      continue;
    }
    if (c === "(") {
      depth++;
      maxDepth = Math.max(maxDepth, depth);
      groupQuantifiers.push(0);
      continue;
    }
    if (c === ")") {
      const body = groupQuantifiers.pop() ?? 0;
      depth--;
      if (depth < 0)
        failStage(
          "asset",
          "PART_LABEL_PATTERN_SYNTAX",
          `Pattern ${patternIndex} has unbalanced groups`,
        );
      if (body > 0 && i + 1 < source.length && isQuantifier(source, i + 1))
        failStage(
          "asset",
          "PART_LABEL_PATTERN_NESTED_QUANTIFIER",
          `Pattern ${patternIndex} quantifies a group that already quantifies`,
        );
      continue;
    }
    if (isQuantifier(source, i)) {
      quantifiers++;
      for (let g = 0; g < groupQuantifiers.length; g++) groupQuantifiers[g]!++;
      if (quantifiers > MAX_QUANTIFIERS)
        failStage(
          "asset",
          "PART_LABEL_PATTERN_COMPLEXITY",
          `Pattern ${patternIndex} uses more than ${MAX_QUANTIFIERS} quantifiers`,
        );
    }
  }
  if (depth !== 0)
    failStage(
      "asset",
      "PART_LABEL_PATTERN_SYNTAX",
      `Pattern ${patternIndex} has unbalanced groups`,
    );
  if (maxDepth > MAX_GROUP_DEPTH)
    failStage(
      "asset",
      "PART_LABEL_PATTERN_COMPLEXITY",
      `Pattern ${patternIndex} nests groups deeper than ${MAX_GROUP_DEPTH}`,
    );
}

function compilePatterns(patterns: readonly PartLabelPattern[]): RegExp[] {
  return patterns.map((pattern, index) => {
    assertSafePatternSource(pattern.match, index);
    try {
      // "u" keeps the source unambiguous; "i" is opt-in so folding is visible in the document.
      return new RegExp(pattern.match, pattern.ignoreCase ? "iu" : "u");
    } catch {
      return failStage(
        "asset",
        "PART_LABEL_PATTERN_SYNTAX",
        `Pattern ${index} is not a valid regular expression`,
      );
    }
  });
}

function checkInput(asset: AssetSpec, labels: PartLabelMap): void {
  if (!Value.Check(AssetSpecSchema, asset))
    failStage("asset", "PART_LABEL_ASSET", "Valid AssetSpec required");
  if (!Value.Check(PartLabelMapSchema, labels))
    failStage("asset", "PART_LABEL_MAP", "Valid PartLabelMap required");
}

/**
 * Resolves one role per part without mutating anything, and reports where each decision came from.
 *
 * Matching target is the part's **`name`** — the artist-facing slot name a naming rule is written
 * against. `id` is deliberately not matched: ids are parser-generated and would make a rule depend
 * on parse order. `overrides` is keyed by `id`, because an override names one exact part.
 *
 * Precedence: `overrides[part.id]` > first matching pattern in order > `unknown`. Parts that match
 * nothing stay `unknown`; nothing is inferred from bounds, draw order or pixels.
 */
export function resolvePartLabels(asset: AssetSpec, labels: PartLabelMap): PartLabelAssignment[] {
  checkInput(asset, labels);
  const compiled = compilePatterns(labels.patterns);
  const overrides = labels.overrides ?? {};
  return asset.parts.map((part) => {
    const override = Object.hasOwn(overrides, part.id) ? overrides[part.id] : undefined;
    if (override)
      return {
        partId: part.id,
        role: override.role,
        ...(override.side === undefined ? {} : { side: override.side }),
        ...(override.rides === undefined ? {} : { rides: override.rides }),
        source: "override" as const,
      };
    for (let index = 0; index < compiled.length; index++) {
      if (!compiled[index]!.test(part.name)) continue;
      const pattern = labels.patterns[index]!;
      return {
        partId: part.id,
        role: pattern.role,
        ...(pattern.side === undefined ? {} : { side: pattern.side }),
        source: "pattern" as const,
        patternIndex: index,
      };
    }
    return { partId: part.id, role: "unknown" as const, source: "unlabelled" as const };
  });
}

/**
 * Pure, deterministic projection of a label map onto an asset: returns a new AssetSpec whose parts
 * carry `role`/`side`/`rides`. The input asset is never mutated and its part order is preserved.
 * Use `resolvePartLabels` when the provenance of each assignment is needed.
 */
export function applyPartLabels(asset: AssetSpec, labels: PartLabelMap): AssetSpec {
  const assignments = resolvePartLabels(asset, labels);
  const parts: AssetPart[] = asset.parts.map((part, index) => {
    const assignment = assignments[index]!;
    return {
      ...part,
      role: assignment.role,
      ...(assignment.side === undefined ? {} : { side: assignment.side }),
      // A `rides` already on the part survives; only an override can restate it.
      ...(assignment.rides === undefined ? {} : { rides: assignment.rides }),
    };
  });
  return { ...asset, parts };
}
