import { Value } from "@sinclair/typebox/value";
import {
  AssetSpecSchema,
  type AssetSpec,
  type ValidationIssue,
  type ValidationReport,
} from "@autospine/schemas";
import { decodeAlphaMask } from "./alpha-mask.js";

export function assetIssue(code: string, reason: string, target?: string): ValidationIssue {
  return { code, stage: "asset", target, severity: 3, reason };
}

export function assetReport(issues: ValidationIssue[]): ValidationReport {
  return {
    schemaVersion: "0.1",
    kind: "validation-report",
    id: "asset-parser-gate-2",
    status: issues.length ? "error" : "passed",
    issues,
  };
}

export class AssetParseError extends Error {
  constructor(readonly validation: ValidationReport) {
    super(validation.issues.map((issue) => issue.reason).join("; "));
    this.name = "AssetParseError";
  }
}

export function failAsset(code: string, reason: string, target?: string): never {
  throw new AssetParseError(assetReport([assetIssue(code, reason, target)]));
}

export function validateAssetSpec(asset: unknown): ValidationReport {
  if (!Value.Check(AssetSpecSchema, asset))
    return assetReport([assetIssue("ASSET_SCHEMA", "AssetSpec shape is invalid")]);
  const spec = asset as AssetSpec;
  const issues: ValidationIssue[] = [];
  const nodes = [...(spec.groups ?? []), ...spec.parts];
  const ids = new Set<string>();
  const groupIds = new Set((spec.groups ?? []).map((group) => group.id));
  for (const node of nodes) {
    if (ids.has(node.id))
      issues.push(assetIssue("DUPLICATE_ID", "Asset IDs must be unique", node.id));
    ids.add(node.id);
  }
  const parents = new Map(nodes.map((node) => [node.id, node.parentId]));
  for (const node of nodes) {
    if (node.parentId && !parents.has(node.parentId))
      issues.push(assetIssue("PARENT_REFERENCE", "Parent does not exist", node.id));
    else if (node.parentId && !groupIds.has(node.parentId))
      issues.push(assetIssue("PARENT_NOT_GROUP", "Parent must be a group", node.id));
    let current: string | undefined = node.id;
    const seen = new Set<string>();
    while (current && parents.has(current)) {
      if (seen.has(current)) {
        issues.push(assetIssue("PARENT_CYCLE", "Hierarchy contains a cycle", node.id));
        break;
      }
      seen.add(current);
      current = parents.get(current);
    }
  }
  const ordered = [...spec.parts].sort((a, b) => a.drawOrder - b.drawOrder);
  if (ordered.some((part, index) => part.drawOrder !== index))
    issues.push(assetIssue("DRAW_ORDER", "Draw order must be unique and contiguous from zero"));
  for (const part of spec.parts) {
    if (part.bounds.width <= 0 || part.bounds.height <= 0)
      issues.push(assetIssue("PART_BOUNDS", "Part display dimensions must be positive", part.id));
    if (part.alphaMask) {
      try {
        decodeAlphaMask(part.alphaMask);
      } catch {
        issues.push(assetIssue("ALPHA_MASK", "Alpha mask runs are invalid", part.id));
      }
    }
  }
  return assetReport(issues);
}

export function acceptAsset(asset: AssetSpec): AssetSpec {
  const validation = validateAssetSpec(asset);
  if (validation.status === "error") throw new AssetParseError(validation);
  return asset;
}
