import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { Type, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { AssetSpecSchema, BuildJobSchema } from "@autospine/schemas";
import { buildJobFile } from "@autospine/cli/build";
import {
  PlannerProposalSchema,
  ReviewEvidenceSchema,
  CorrectionSpecSchema,
  validatePlannerProposal,
  executePlannerProposal,
  evidenceFromBuild,
  criticMetrics,
  rebuildFromCorrection,
} from "@autospine/planning";

const strict = { additionalProperties: false };
const toolSchemas = {
  autospine_get_status: Type.Object({}, strict),
  autospine_validate_plan: Type.Object(
    { asset: AssetSpecSchema, proposal: PlannerProposalSchema },
    strict,
  ),
  autospine_execute_plan: Type.Object(
    { asset: AssetSpecSchema, job: BuildJobSchema, proposal: PlannerProposalSchema },
    strict,
  ),
  autospine_build: Type.Object({ jobPath: Type.String({ minLength: 1, maxLength: 4096 }) }, strict),
  autospine_review_metrics: Type.Object(
    { evidence: ReviewEvidenceSchema, amplitudeDegrees: Type.Number({ minimum: 0, maximum: 45 }) },
    strict,
  ),
  autospine_apply_correction: Type.Object(
    {
      asset: AssetSpecSchema,
      job: BuildJobSchema,
      proposal: PlannerProposalSchema,
      correction: CorrectionSpecSchema,
      manifestId: Type.String({ minLength: 1 }),
    },
    strict,
  ),
};
const descriptions: Record<keyof typeof toolSchemas, string> = {
  autospine_get_status: "Read engineering status and explicit unverified capabilities; no writes.",
  autospine_validate_plan:
    "Validate an explicit chain proposal; low confidence is review-required.",
  autospine_execute_plan:
    "Run a validated plan in memory and measure it; no files or art approval.",
  autospine_build:
    "Build a host-approved job within the configured workspace into a NEW directory.",
  autospine_review_metrics: "Propose a bounded numeric correction, not a visual AI approval.",
  autospine_apply_correction:
    "Rebuild in memory from a fingerprint-bound correction and remeasure.",
};
export const mcpTools = Object.entries(toolSchemas).map(([name, inputSchema]) => ({
  name,
  description: descriptions[name as keyof typeof toolSchemas],
  inputSchema,
  annotations: {
    readOnlyHint: name !== "autospine_build",
    destructiveHint: false,
    idempotentHint: name !== "autospine_build",
    openWorldHint: false,
  },
}));
function contains(root: string, target: string): boolean {
  const sub = relative(root, target);
  return (
    sub === "" ||
    (!isAbsolute(sub) && sub !== ".." && !sub.startsWith("../") && !sub.startsWith("..\\"))
  );
}
function policy(condition: boolean) {
  if (!condition)
    throw new Error(
      "MCP_WORKSPACE_POLICY: job, source and new output must remain inside the configured workspace",
    );
}
/** Trusted host root, never a tool argument. This is a scope guard, not a hostile-filesystem sandbox. */
export async function guardJob(rootPath: string, jobPath: string): Promise<string> {
  const root = await realpath(resolve(rootPath)),
    file = resolve(root, jobPath);
  policy(contains(root, file));
  policy(contains(root, await realpath(file)));
  const entry = await lstat(file);
  policy(entry.isFile() && !entry.isSymbolicLink() && entry.size <= 64 * 1024);
  const job: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!Value.Check(BuildJobSchema, job))
    throw new Error("MCP_JOB_SCHEMA: strict chain-wave job required");
  const source = resolve(dirname(file), job.source),
    output = resolve(dirname(file), job.output);
  policy(contains(root, source) && contains(root, output));
  policy(contains(root, await realpath(source)));
  policy((await lstat(source)).isFile());
  let parent = dirname(output);
  for (;;) {
    try {
      policy(contains(root, await realpath(parent)));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const next = dirname(parent);
      policy(next !== parent && contains(root, next));
      parent = next;
    }
  }
  return file;
}
const result = (value: unknown, isError = false) => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  structuredContent: value,
  ...(isError ? { isError: true } : {}),
});
function safeFailure(error: unknown) {
  const value = error as { validation?: unknown; message?: string; code?: string };
  if (value.validation) return { validation: value.validation, artistQualityAccepted: false };
  // No raw filesystem errors/paths or private request bodies on the protocol channel.
  const known = value.message?.match(/^(MCP_[A-Z_]+): ([^\n]+)$/);
  return {
    code: known?.[1] ?? "MCP_TOOL_FAILED",
    reason: known?.[2] ?? "Tool failed; check valid input and a new workspace-local output",
    artistQualityAccepted: false,
  };
}
export class AutoSpineMcpServer {
  private initialized = false;
  private ready = false;
  constructor(readonly workspace: string) {}
  private async call(name: keyof typeof toolSchemas, args: unknown) {
    const schema: TSchema = toolSchemas[name];
    if (!Value.Check(schema, args))
      return result(
        { code: "MCP_TOOL_ARGUMENTS", reason: "Arguments do not match the strict tool schema" },
        true,
      );
    try {
      switch (name) {
        case "autospine_get_status": {
          let status: unknown = { available: false };
          try {
            status = JSON.parse(
              await readFile(resolve(this.workspace, "docs/reviews/GATE_5_17_STATUS.json"), "utf8"),
            );
          } catch {
            /* Optional in fixture/client workspaces. */
          }
          return result({
            status,
            capabilities: {
              profile: "chain-wave",
              explicitChainRequired: true,
              livePlannerVerified: false,
              liveVisionCriticVerified: false,
              artistQualityAccepted: false,
              filesystemBuild: "workspace-local-new-output-only",
            },
          });
        }
        case "autospine_validate_plan": {
          if (!Value.Check(toolSchemas.autospine_validate_plan, args)) break;
          const proposal = validatePlannerProposal(args.proposal, args.asset);
          return result({
            proposal,
            reviewRequired: proposal.confidence < 0.8,
            artistQualityAccepted: false,
          });
        }
        case "autospine_execute_plan": {
          if (!Value.Check(toolSchemas.autospine_execute_plan, args)) break;
          const built = executePlannerProposal(args.asset, args.job, args.proposal);
          return result({
            evidence: evidenceFromBuild(built, args.job.id, args.proposal),
            diagnostics: built.diagnostics,
          });
        }
        case "autospine_build": {
          if (!Value.Check(toolSchemas.autospine_build, args)) break;
          const file = await guardJob(this.workspace, args.jobPath),
            output = await buildJobFile(file);
          return result({
            output,
            manifest: JSON.parse(await readFile(resolve(output, "manifest.json"), "utf8")),
            diagnostics: JSON.parse(await readFile(resolve(output, "diagnostics.json"), "utf8")),
            provenance: JSON.parse(await readFile(resolve(output, "provenance.json"), "utf8")),
          });
        }
        case "autospine_review_metrics": {
          if (!Value.Check(toolSchemas.autospine_review_metrics, args)) break;
          return result({
            correction: criticMetrics(args.evidence, args.amplitudeDegrees),
            scope: "numeric-baseline-not-visual-AI",
          });
        }
        case "autospine_apply_correction": {
          if (!Value.Check(toolSchemas.autospine_apply_correction, args)) break;
          const built = rebuildFromCorrection(
            args.asset,
            args.job,
            args.proposal,
            args.correction,
            args.manifestId,
          );
          return result({
            evidence: evidenceFromBuild(built.result, args.manifestId, built.proposal),
            diagnostics: built.result.diagnostics,
            engineeringPassed: built.engineeringPassed,
            artistQualityAccepted: built.artistQualityAccepted,
          });
        }
      }
      return result({ code: "MCP_TOOL_ARGUMENTS" }, true);
    } catch (error) {
      return result(safeFailure(error), true);
    }
  }
  async receive(value: unknown): Promise<unknown | undefined> {
    const req = value as {
      jsonrpc?: unknown;
      method?: unknown;
      id?: unknown;
      params?: unknown;
    } | null;
    const validId =
      typeof req?.id === "string" || (typeof req?.id === "number" && Number.isFinite(req.id));
    const error = (code: number, message: string) => ({
      jsonrpc: "2.0",
      id: validId ? req!.id : null,
      error: { code, message },
    });
    if (
      !req ||
      Array.isArray(req) ||
      req.jsonrpc !== "2.0" ||
      typeof req.method !== "string" ||
      (req.id !== undefined && !validId)
    )
      return error(-32600, "Invalid request");
    if (req.id === undefined) {
      if (req.method === "notifications/initialized" && this.initialized) this.ready = true;
      return undefined; // Notifications never invoke mutation tools.
    }
    const response = (payload: unknown) => ({ jsonrpc: "2.0", id: req.id, result: payload });
    if (req.method === "initialize") {
      const params = req.params as
        | {
            protocolVersion?: unknown;
            capabilities?: unknown;
            clientInfo?: { name?: unknown; version?: unknown };
          }
        | undefined;
      if (
        this.initialized ||
        typeof params?.protocolVersion !== "string" ||
        params.protocolVersion.length === 0 ||
        !params.capabilities ||
        typeof params.capabilities !== "object" ||
        Array.isArray(params.capabilities) ||
        typeof params.clientInfo?.name !== "string" ||
        typeof params.clientInfo.version !== "string"
      )
        return error(-32602, "Valid, single initialize request required");
      this.initialized = true;
      return response({
        protocolVersion: params.protocolVersion === "2025-06-18" ? "2025-06-18" : "2025-11-25",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "autospine", version: "0.0.0" },
        instructions:
          "Legacy MCP v1; explicit chain-wave only. No live visual AI or artist approval. Build requires host authorization and new workspace-local output.",
      });
    }
    if (req.method === "ping") return response({});
    // Explicit legacy v1: modern discovery returns method-not-found for client fallback.
    if (req.method === "server/discover") return error(-32601, "Legacy v1 adapter; use initialize");
    if (!this.ready) return error(-32002, "Initialization and initialized notification required");
    if (req.method === "tools/list") {
      if (req.params !== undefined && !Value.Check(Type.Object({}, strict), req.params))
        return error(-32602, "This server returns all tools; no cursor or extra parameters");
      return response({ tools: mcpTools });
    }
    if (req.method === "tools/call") {
      const p = req.params as { name?: unknown; arguments?: unknown } | undefined;
      if (typeof p?.name !== "string" || !Object.hasOwn(toolSchemas, p.name))
        return error(-32602, "Known tool name required");
      return response(await this.call(p.name as keyof typeof toolSchemas, p.arguments ?? {}));
    }
    return error(-32601, "Method not found");
  }
}
