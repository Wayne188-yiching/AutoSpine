import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { Type, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  AssetPartSchema,
  AssetSpecSchema,
  BuildJobSchema,
  IdSchema,
  KeyposeSpecSchema,
  MeshSpecSchema,
  RigSpecSchema,
  Vector2Schema,
  WeightSpecSchema,
} from "@autospine/schemas";
import { decodeAlphaMask } from "@autospine/assets";
import { generateFeatureMesh } from "@autospine/mesh";
import { buildKeyposeAnimation } from "@autospine/motion";
import {
  domeFoldLimit,
  domeValue,
  measureDeformation,
  measureDomeField,
  measureOverlapDrift,
  skinVertices,
  solveChainWeights,
  solveDomeWeights,
  solveGradientWeights,
  transferWeights,
} from "@autospine/weights";
import { buildJobFile } from "@autospine/cli/build";
import { CharacterSpineInputSchema, compileCharacterSpine40 } from "@autospine/spine";
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
// Engine-tool argument shapes (ADR-010..016); all in memory, no filesystem access.
const Affine = Type.Tuple([
  Type.Number(),
  Type.Number(),
  Type.Number(),
  Type.Number(),
  Type.Number(),
  Type.Number(),
]);
const DomeField = Type.Object(
  { center: Vector2Schema, radii: Vector2Schema, peak: Type.Number(), counter: Type.Number() },
  strict,
);
const DomePins = Type.Array(
  Type.Object(
    {
      polygon: Type.Array(Vector2Schema, { minItems: 3, maxItems: 4096 }),
      value: Type.Number(),
      margin: Type.Number(),
    },
    strict,
  ),
  { maxItems: 64 },
);
const Weighted = Type.Object({ mesh: MeshSpecSchema, weights: WeightSpecSchema }, strict);
const Pose = Type.Object(
  {
    rotations: Type.Optional(Type.Record(IdSchema, Type.Number())),
    translations: Type.Optional(Type.Record(IdSchema, Vector2Schema)),
    scales: Type.Optional(Type.Record(IdSchema, Vector2Schema)),
  },
  strict,
);
const toolSchemas = {
  autospine_compile_character: Type.Object({ input: CharacterSpineInputSchema }, strict),
  autospine_build_keypose_animation: Type.Object(
    { rig: RigSpecSchema, spec: KeyposeSpecSchema },
    strict,
  ),
  autospine_feature_mesh: Type.Object(
    {
      part: AssetPartSchema,
      options: Type.Optional(
        Type.Object(
          {
            minHoleFraction: Type.Optional(Type.Number()),
            edgeLength: Type.Optional(Type.Number()),
            spacing: Type.Optional(Type.Number()),
          },
          strict,
        ),
      ),
    },
    strict,
  ),
  autospine_measure_dome: Type.Object(
    {
      part: AssetPartSchema,
      toWorld: Affine,
      anchor: Type.Optional(Vector2Schema),
      peak: Type.Optional(Type.Number()),
      counter: Type.Optional(Type.Number()),
    },
    strict,
  ),
  autospine_dome_weights: Type.Object(
    {
      mesh: MeshSpecSchema,
      rig: RigSpecSchema,
      field: DomeField,
      bones: Type.Object(
        { base: IdSchema, control: IdSchema, counter: Type.Optional(IdSchema) },
        strict,
      ),
      pins: Type.Optional(DomePins),
      points: Type.Optional(Type.Array(Vector2Schema, { maxItems: 256 })),
    },
    strict,
  ),
  autospine_transfer_weights: Type.Object(
    {
      target: MeshSpecSchema,
      rig: RigSpecSchema,
      sources: Type.Array(Weighted, { minItems: 1, maxItems: 16 }),
      maxInfluences: Type.Optional(Type.Integer({ minimum: 1, maximum: 4 })),
    },
    strict,
  ),
  autospine_chain_weights: Type.Object(
    {
      mesh: MeshSpecSchema,
      rig: RigSpecSchema,
      boneIds: Type.Array(IdSchema, { minItems: 1, maxItems: 64 }),
      blendWidth: Type.Union([Type.Number(), Type.Array(Type.Number(), { maxItems: 63 })]),
    },
    strict,
  ),
  autospine_gradient_weights: Type.Object(
    { mesh: MeshSpecSchema, rig: RigSpecSchema, from: IdSchema, to: IdSchema },
    strict,
  ),
  autospine_measure_overlap: Type.Object(
    { rig: RigSpecSchema, a: Weighted, b: Weighted, pose: Type.Optional(Pose) },
    strict,
  ),
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
  autospine_compile_character:
    "Compile explicit multi-part engine IR, bone/attachment/rgba/deform timelines, convex clipping and native IK/Transform to Spine 4.0 JSON in memory; no automatic anatomy or artist approval.",
  autospine_build_keypose_animation:
    "Compile a pose table (beats) plus follow/saccade/settle/cycle timing rules into a sparse AnimationSpec with per-key curves (ADR-011); beat timing is the caller's input.",
  autospine_feature_mesh:
    "Mesh a part by its opaque silhouette with a locked vertex ring around every large enclosed hole (eye sockets, windows); returns MeshSpec in part-bounds space and ring indices (ADR-016).",
  autospine_measure_dome:
    "Measure a dome (parallax) field from a part's alpha: centre = centroid or anchor, radii = 2 x alpha std in world via a pixel-to-world affine; also returns the fold limit (ADR-012).",
  autospine_dome_weights:
    "Weight a world-space mesh to a dome field (control/counter/base bones), optionally pinning regions such as eye sockets to a follow mix; returns WeightSpec and dome values at requested points (ADR-012/016).",
  autospine_transfer_weights:
    "Closest-point barycentric weight transfer from weighted source meshes to a riding mesh such as a glow or outline (ADR-013).",
  autospine_chain_weights:
    "Joint-plane chain weights with one blend width per joint; share one chain between images that meet at a joint (ADR-014).",
  autospine_gradient_weights:
    "Linear two-bone gradient between two bone origins (eyelids, jaws, flaps); fold-free until full collapse (ADR-015).",
  autospine_measure_overlap:
    "Skin two weighted meshes in an optional pose and report overlap seam drift plus inversions per mesh; numeric QA, not artist approval.",
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
        case "autospine_compile_character": {
          if (!Value.Check(toolSchemas.autospine_compile_character, args)) break;
          return result({
            document: compileCharacterSpine40(args.input),
            scope: "explicit-character-ir",
            artistQualityAccepted: false,
          });
        }
        case "autospine_build_keypose_animation": {
          if (!Value.Check(toolSchemas.autospine_build_keypose_animation, args)) break;
          const animation = buildKeyposeAnimation(args.rig, args.spec);
          const keyCount = [
            ...(animation.rotationTimelines ?? []),
            ...(animation.translationTimelines ?? []),
            ...(animation.scaleTimelines ?? []),
          ].reduce((n, t) => n + t.keys.length, 0);
          return result({ animation, keyCount, artistQualityAccepted: false });
        }
        case "autospine_feature_mesh": {
          if (!Value.Check(toolSchemas.autospine_feature_mesh, args)) break;
          if (!args.part.alphaMask)
            throw new Error("MCP_PART_ALPHA: the part needs an rle8 alphaMask");
          const built = generateFeatureMesh(
            args.part,
            decodeAlphaMask(args.part.alphaMask),
            args.options ?? {},
          );
          return result({ ...built, space: "part-bounds" });
        }
        case "autospine_measure_dome": {
          if (!Value.Check(toolSchemas.autospine_measure_dome, args)) break;
          if (!args.part.alphaMask)
            throw new Error("MCP_PART_ALPHA: the part needs an rle8 alphaMask");
          const mask = args.part.alphaMask,
            field = measureDomeField(decodeAlphaMask(mask), mask.width, mask.height, args.toWorld, {
              ...(args.anchor ? { anchor: args.anchor } : {}),
              ...(args.peak === undefined ? {} : { peak: args.peak }),
              ...(args.counter === undefined ? {} : { counter: args.counter }),
            });
          return result({ field, foldLimit: domeFoldLimit(field) });
        }
        case "autospine_dome_weights": {
          if (!Value.Check(toolSchemas.autospine_dome_weights, args)) break;
          const pins = args.pins ?? [];
          return result({
            weights: solveDomeWeights(args.mesh, args.rig, args.field, args.bones, pins),
            values: (args.points ?? []).map((p) => domeValue(args.field, p, pins)),
          });
        }
        case "autospine_transfer_weights": {
          if (!Value.Check(toolSchemas.autospine_transfer_weights, args)) break;
          return result({
            weights: transferWeights(args.target, args.rig, args.sources, args.maxInfluences ?? 4),
          });
        }
        case "autospine_chain_weights": {
          if (!Value.Check(toolSchemas.autospine_chain_weights, args)) break;
          return result({
            weights: solveChainWeights(args.mesh, args.rig, args.boneIds, args.blendWidth),
          });
        }
        case "autospine_gradient_weights": {
          if (!Value.Check(toolSchemas.autospine_gradient_weights, args)) break;
          return result({
            weights: solveGradientWeights(args.mesh, args.rig, args.from, args.to),
          });
        }
        case "autospine_measure_overlap": {
          if (!Value.Check(toolSchemas.autospine_measure_overlap, args)) break;
          const pose = args.pose ?? {},
            posed = [args.a, args.b].map((m) =>
              skinVertices(m.mesh, args.rig, m.weights, pose.rotations ?? {}, {
                ...(pose.translations ? { translations: pose.translations } : {}),
                ...(pose.scales ? { scales: pose.scales } : {}),
              }),
            );
          return result({
            drift: measureOverlapDrift(
              { mesh: args.a.mesh, posed: posed[0]! },
              { mesh: args.b.mesh, posed: posed[1]! },
            ),
            deformation: [args.a, args.b].map((m, i) => measureDeformation(m.mesh, posed[i]!)),
            artistQualityAccepted: false,
          });
        }
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
              inMemoryCharacterCompilation:
                "explicit-regions-weighted-meshes-convex-clipping-bone-attachment-rgba-deform-timelines-native-IK-Transform",
              explicitChainRequired: true,
              livePlannerVerified: false,
              liveVisionCriticVerified: false,
              artistQualityAccepted: false,
              filesystemBuild: "workspace-local-new-output-only",
              keyCurves: "linear-stepped-bezier-per-key",
              keyposeGrammar: "beats-follow-saccade-settle-cycle",
              weights: "dome-with-pins-transfer-joint-plane-chain-gradient",
              featureMesh: "silhouette-hull-and-hole-rings",
              overlapQA: "seam-drift-and-inversions",
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
          "Legacy MCP v1; chain-wave file build, explicit character IR compilation and in-memory engine tools (pose-table animation, feature meshes, dome/transfer/chain/gradient weights, overlap QA). No live visual AI or artist approval. Build requires host authorization and new workspace-local output.",
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
