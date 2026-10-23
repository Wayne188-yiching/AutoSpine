import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { Type, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  AnimationSpecSchema,
  AssetPartSchema,
  AssetSpecSchema,
  BuildJobSchema,
  CharacterPlanSchema,
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
import { AUTOSPINE_VERSION } from "@autospine/cli/version";
import { advertisedSchema } from "./api-schema.js";
import {
  buildCharacterFiles,
  compareReferenceFiles,
  compareVideoFiles,
  lintPlanFile,
  optimizeMotionFiles,
  reviewVideoFiles,
  fitPoseFiles,
  fitVideoFiles,
  draftMotionFiles,
  mergePlanFiles,
} from "@autospine/cli/character";
import { reduceKeysFiles } from "@autospine/cli/keys";
import { DRAFT_KINDS, lintCharacterPlan } from "@autospine/character";
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
  KeyStatsSchema,
  PerformanceProfileSchema,
  PerformanceSampleSchema,
  animationKeyStats,
  reviewPerformance,
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
const WorkspacePath = Type.String({ minLength: 1, maxLength: 4096 });
/** World-vertex limits of one key reduction mode, skeleton px (ADR-044). */
const LimitSchema = Type.Object(
  {
    maxError: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 100 })),
    rmsError: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 100 })),
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
  autospine_review_performance: Type.Object(
    {
      sample: PerformanceSampleSchema,
      profile: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), PerformanceProfileSchema]),
      animation: Type.Optional(AnimationSpecSchema),
      keyStats: Type.Optional(KeyStatsSchema),
    },
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
  // Character plans (ADR-017). The plan is checked against CharacterPlan-0.1 in the handler so
  // that a malformed plan gets its schema errors back instead of a bare argument rejection.
  autospine_lint_character_plan: Type.Object(
    {
      plan: Type.Unknown(),
      partNames: Type.Optional(
        Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 4096 }),
      ),
    },
    strict,
  ),
  autospine_build_character: Type.Object(
    { planPath: WorkspacePath, outputDir: WorkspacePath, paramsPath: Type.Optional(WorkspacePath) },
    strict,
  ),
  autospine_compare_reference: Type.Object(
    {
      planPath: WorkspacePath,
      buildDir: WorkspacePath,
      artistPath: WorkspacePath,
      outputDir: WorkspacePath,
      animation: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    },
    strict,
  ),
  autospine_optimize_motion: Type.Object(
    {
      planPath: WorkspacePath,
      artistPath: WorkspacePath,
      stateDir: WorkspacePath,
      budgetSeconds: Type.Optional(Type.Integer({ minimum: 5, maximum: 600 })),
      margin: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
      seed: Type.Optional(Type.Integer({ minimum: 0, maximum: 2 ** 31 - 1 })),
    },
    strict,
  ),
  autospine_review_video: Type.Object(
    {
      planPath: WorkspacePath,
      buildDir: WorkspacePath,
      artistPath: Type.Optional(WorkspacePath),
      outputPath: WorkspacePath,
      loops: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
      referenceVideoPath: Type.Optional(WorkspacePath),
    },
    strict,
  ),
  autospine_compare_video: Type.Object(
    {
      planPath: WorkspacePath,
      buildDir: WorkspacePath,
      videoPath: WorkspacePath,
      outputDir: WorkspacePath,
      animation: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
      start: Type.Optional(Type.Number({ minimum: 0, maximum: 3600 })),
    },
    strict,
  ),
  autospine_motion_draft: Type.Object(
    {
      planPath: WorkspacePath,
      outputPath: WorkspacePath,
      animation: Type.String({ minLength: 1, maxLength: 64 }),
      kind: Type.Optional(Type.Union(DRAFT_KINDS.map((k) => Type.Literal(k)))),
      frames: Type.Optional(Type.Integer({ minimum: 4, maximum: 3600 })),
      subject: Type.Optional(Type.Union([Type.Literal("character"), Type.Literal("prop")])),
    },
    strict,
  ),
  autospine_merge_plans: Type.Object(
    {
      planPaths: Type.Array(WorkspacePath, { minItems: 2, maxItems: 64 }),
      outputPath: WorkspacePath,
      id: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
      name: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    },
    strict,
  ),
  autospine_fit_pose: Type.Object(
    {
      planPath: WorkspacePath,
      buildDir: WorkspacePath,
      /** One picture of the rest pose (ADR-024); or `references` for key poses. */
      referencePath: Type.Optional(WorkspacePath),
      /** Pictures of key poses on their frames (ADR-033): storyboard or video frames. */
      references: Type.Optional(
        Type.Array(
          Type.Object(
            { frame: Type.Integer({ minimum: 0, maximum: 3600 }), path: WorkspacePath },
            strict,
          ),
          { minItems: 1, maxItems: 64 },
        ),
      ),
      outputPath: WorkspacePath,
      animation: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
      ease: Type.Optional(
        Type.Union([
          Type.Literal("linear"),
          Type.Literal("hold"),
          Type.Literal("ease"),
          Type.Literal("sine"),
          Type.Literal("out"),
          Type.Literal("in"),
          Type.Literal("drift"),
        ]),
      ),
      minCoverage: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      ignore: Type.Optional(
        Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 512 }),
      ),
      zeroFrame: Type.Optional(Type.Integer({ minimum: 0, maximum: 3600 })),
      window: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
      maxRotate: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 90 })),
    },
    strict,
  ),
  autospine_fit_video: Type.Object(
    {
      planPath: WorkspacePath,
      buildDir: WorkspacePath,
      videoPath: WorkspacePath,
      outputDir: WorkspacePath,
      animation: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
      start: Type.Optional(Type.Number({ minimum: 0, maximum: 3600 })),
      rounds: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
      every: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })),
      ignore: Type.Optional(
        Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { maxItems: 512 }),
      ),
      zero: Type.Optional(Type.Boolean()),
      track: Type.Optional(Type.Boolean()),
      lag: Type.Optional(Type.Boolean()),
    },
    strict,
  ),
  // Key reduction (ADR-044): the same file-level step as `autospine reduce-keys`.
  autospine_reduce_keys: Type.Object(
    {
      inputPath: WorkspacePath,
      outputDir: WorkspacePath,
      modes: Type.Optional(
        Type.Array(Type.Union([Type.Literal("fidelity"), Type.Literal("posable")]), {
          minItems: 1,
          maxItems: 2,
        }),
      ),
      limits: Type.Optional(
        Type.Object(
          {
            fidelity: Type.Optional(LimitSchema),
            posable: Type.Optional(LimitSchema),
          },
          strict,
        ),
      ),
      fps: Type.Optional(Type.Number({ minimum: 1, maximum: 240 })),
      animations: Type.Optional(
        Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 256 }),
      ),
      kinds: Type.Optional(
        Type.Array(
          Type.Union(
            ["bone", "slot", "ik", "transform", "path", "deform"].map((k) => Type.Literal(k)),
          ),
          { maxItems: 6 },
        ),
      ),
      skip: Type.Optional(
        Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 4096 }),
      ),
      lock: Type.Optional(
        Type.Array(
          Type.Object(
            {
              animation: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
              timeline: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
              time: Type.Optional(Type.Number({ minimum: 0, maximum: 3600 })),
            },
            strict,
          ),
          { maxItems: 4096 },
        ),
      ),
      loops: Type.Optional(
        Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 256 }),
      ),
      baselinePath: Type.Optional(WorkspacePath),
      imagesDir: Type.Optional(WorkspacePath),
      video: Type.Optional(Type.Boolean()),
    },
    strict,
  ),
};
const descriptions: Record<keyof typeof toolSchemas, string> = {
  autospine_reduce_keys:
    "Reduce the keys of a workspace-local Spine 4.0 JSON (ADR-044) into a NEW workspace-local directory, in `fidelity` (fewest keys within the limit, refitted Spine Bezier curves) and/or `posable` (shared pose frames for main bones on whole frames, follow parts on their own turns) mode, each with its own world-vertex limit (px; default by mode from the skeleton size; never widened to reach a ratio). Every result is played on the official runtime against the untouched source (hierarchy, weights, IK/transform/path, deform): max and RMS vertex error, worst time and part, pose nodes, contact slide, follow lag, loop seam, discrete states; keys are added where it is off and timelines fall back to the original past the budget. Writes per mode <name>.json and key-report.json, plus summary.json and key-reduction-report.html/.md. The Spine editor import/export check runs only from the CLI (`autospine reduce-keys`); `video: true` renders original | modes with ffmpeg and the images. Not an artist approval.",
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
  autospine_review_performance:
    "Measure performance metrics from sampled probes (parallax, pupil, holds, saccade speed, delay-chain peaks, hand vs body, key density) and compare them with an artist-statistics profile; findings only, not artist approval.",
  autospine_get_status:
    "Read the engine version (compare it with the command line's `--version`: a server left running from an earlier plugin version reports an older one), the workspace and explicit unverified capabilities; no writes.",
  autospine_validate_plan:
    "Validate an explicit chain proposal; low confidence is review-required.",
  autospine_execute_plan:
    "Run a validated plan in memory and measure it; no files or art approval.",
  autospine_build:
    "Build a host-approved job within the configured workspace into a NEW directory.",
  autospine_review_metrics: "Propose a bounded numeric correction, not a visual AI approval.",
  autospine_apply_correction:
    "Rebuild in memory from a fingerprint-bound correction and remeasure.",
  autospine_lint_character_plan:
    "Check a character plan (CharacterPlan-0.1, ADR-017) in memory: schema errors, then joints, bones, meshes, constraints, motion controls, parameter references and expressions; with partNames also every named part and that each image has a mesh or region bone. Run after every plan edit.",
  autospine_build_character:
    "Build a workspace-local character plan (images-only layout + images) into a NEW workspace-local directory: Spine 4.0 JSON, IR, keypose specs, build record and copied images. The plan is linted first; no artist approval.",
  autospine_compare_reference:
    "Compare a character build with an artist Spine 4.0 baseline on the official runtime and check the pre-registered acceptance criteria; writes results and contact sheets into a NEW workspace-local directory. Compares the plan's animations the artist file also has (or only `animation`); a full artist export may hold more, which are listed as artistOnly. Numeric acceptance, not artist approval.",
  autospine_optimize_motion:
    "Resumable pattern search of the plan's motion.search parameters against an artist baseline for at most budgetSeconds; state, best-params.json and a log live in a workspace-local state directory. Call again to continue while status is paused.",
  autospine_motion_draft:
    "Draft one animation's motion from the measured priors (ADR-048, ADR-032) into a NEW workspace-local plan file. `kind` defaults from the name: idle, walk (character loops), prop (a prop's loop), or a one-shot: entry (In, Appear), exit (Out), jump (Win, Goal, Jump), charge, press, levelup, look, transition (anything else); a wave (Wave, Hello) or blinks (Blink; blinks go into an animation the plan has, normally the idle, and keep its length). A loop gets a breath main, head follow, strand waves and limb swings; a one-shot gets keys on a `move` bone (added at the feet when missing), a head look and alpha on the shown parts; a wave keys the arm and forearm; blinks swap to a closed-eye image, show a lid hidden in setup, or squash the eyes probe's bone, with conventional timing (ADR-049). Only that animation changes; a new animation shows the parts the idle shows. The plan is linted before it is written; notes say what was added, replaced or kept. A starting point to build, watch and adjust.",
  autospine_merge_plans:
    "Merge workspace-local character plans of one character (same images-only layout) into a NEW plan file (ADR-031): the rigs are united, and every animation keeps the motion it was planned with, so one build gives one Spine project with all animations. Conflicting joints, bones, meshes or regions are listed and nothing is written.",
  autospine_fit_pose:
    "Fit an animation's rest pose (ADR-024) to a PNG reference covering plan.qa.view: parts are matched per bone on their visible colours, then the plan's bones (face rig excluded) are solved on the official runtime. Writes a NEW workspace-local JSON whose `pose` goes into motion.animations[].pose. With `references` (pictures on frames: storyboard or video frames) it fits key poses instead (ADR-033), each over the build's pose on its frame; pictures below minCoverage (default 0.6) are left out, and the written `keyposes` replace motion.animations[].keyposes. `ignore` leaves out parts whose drawing changes (an expression's mouth, eyes, tongue); `zeroFrame` names a picture whose pose the build already shows (the rest pose fitted from it): it gives no key pose and its matching error is taken off the others. Expressions, scaling and mesh deforms are not fitted.",
  autospine_compare_video:
    "Compare a character build with a reference video of the motion (ADR-034; needs ffmpeg): the build is placed over the video's figure and compared frame by frame from `start` seconds — outline overlap (V1), each part's position against where it shows in the video (V2), whole-figure timing and size (V3) and the loop seam (V4). Writes a NEW workspace-local directory with <animation>/compare.mp4 (reference | build | difference), report.json and summary.json; `hints` say in words where it differs, including parts the video clearly draws mirrored (left-right) and on which frames (ADR-035 `mirror`; a part only redrawn, such as an expression, is not counted). The video needs a plain background and must start at the animation's frame 0. Reports only: it changes nothing.",
  autospine_fit_video:
    "Take one animation's motion from a reference video (ADR-036; needs ffmpeg, plan.qa.view and motion.fps): every frame of the video (plain background, starting at the animation's frame 0) is placed over the build and fitted like a key-pose picture over a base that has the plan's guessed main motion taken out; a loop's tracks are folded onto the period the video repeats with, a one-shot's smoothed, and both reduced to key poses on shared key frames (at most twice the artists' key density). Each round builds and compares with the video (compare-video rows); later rounds refit the frames still off and rescale or re-time chain waves from the comparison. Writes a NEW workspace-local directory: pictures/, base/, round-k/{plan.json, build/, compare/}, best/ (the lowest penalty) and summary.json. The source plan is not changed; put best/plan.json's keyposes into the plan, or deliver best/. Each part is followed from the frame before, forward and then backward through the clip (ADR-039); a bone the two passes disagree on is left as a gap on that frame and named in hints (`track: false` fits every frame alone). A bone that trails or leads the others in the video keeps that timing as `keyposeLag` in the plan, frames off the shared key frames (ADR-040; `lag: false` keys every bone on them). Expressions, mesh deforms, scale and parts the video redraws are not fitted and are named in hints. summary.json `zero.shifted` is the share of frame 0's matched parts drawn more than 1.5% of the figure height from the build's frame 0; above a quarter a hint asks to fit the rest pose from frame 0 first. Results are reference-fitted, not blind.",
  autospine_review_video:
    "Render a NEW workspace-local MP4 review video (needs ffmpeg): every plan animation as artist | build (reference video | build with referenceVideoPath, its frame i beside animation frame i; the build alone without either), first with the mesh wireframe, then with the bones, then the plain motion, on the official runtime. For the human review (criterion E); not an approval.",
};
/** Tools that write into the workspace (new directories, or the optimizer's own state directory). */
const writingTools = new Set<string>([
  "autospine_build",
  "autospine_build_character",
  "autospine_compare_reference",
  "autospine_optimize_motion",
  "autospine_review_video",
  "autospine_compare_video",
  "autospine_fit_pose",
  "autospine_fit_video",
  "autospine_merge_plans",
  "autospine_motion_draft",
  "autospine_reduce_keys",
]);
export const mcpTools = Object.entries(toolSchemas).map(([name, inputSchema]) => ({
  name,
  description: descriptions[name as keyof typeof toolSchemas],
  inputSchema: advertisedSchema(inputSchema),
  annotations: {
    readOnlyHint: !writingTools.has(name),
    destructiveHint: false,
    idempotentHint: !writingTools.has(name),
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
/** An existing regular file inside the workspace (no symlink), at most `maxBytes`. */
export async function guardFile(root: string, path: string, maxBytes: number): Promise<string> {
  const file = resolve(root, path);
  policy(contains(root, file));
  policy(contains(root, await realpath(file)));
  const entry = await lstat(file);
  policy(entry.isFile() && !entry.isSymbolicLink() && entry.size <= maxBytes);
  return file;
}
/** An existing directory inside the workspace. */
async function guardDirectory(root: string, path: string): Promise<string> {
  const dir = resolve(root, path);
  policy(contains(root, dir));
  policy(contains(root, await realpath(dir)));
  policy((await lstat(dir)).isDirectory());
  return dir;
}
/** An output directory inside the workspace whose nearest existing ancestor is inside too. */
export async function guardOutput(root: string, path: string, mustBeNew: boolean): Promise<string> {
  const output = resolve(root, path);
  policy(contains(root, output) && output !== root);
  let parent = output;
  for (;;) {
    try {
      policy(contains(root, await realpath(parent)));
      if (parent === output) {
        if (mustBeNew) throw new Error("MCP_OUTPUT_EXISTS: choose a new output directory");
        policy((await lstat(output)).isDirectory());
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const next = dirname(parent);
      policy(next !== parent && contains(root, next));
      parent = next;
    }
  }
  return output;
}
/** A plan file plus the images-only layout and image folder it names, all inside the workspace. */
export async function guardPlan(
  rootPath: string,
  planPath: string,
): Promise<{ root: string; plan: string }> {
  const root = await realpath(resolve(rootPath));
  const plan = await guardFile(root, planPath, 4 * 1024 * 1024);
  const parsed: unknown = JSON.parse(await readFile(plan, "utf8"));
  if (!Value.Check(CharacterPlanSchema, parsed))
    throw new Error("MCP_PLAN_SCHEMA: not a CharacterPlan-0.1; run autospine_lint_character_plan");
  await guardFile(root, resolve(dirname(plan), parsed.source.imagesOnly), 64 * 1024 * 1024);
  await guardDirectory(root, resolve(dirname(plan), parsed.source.images));
  return { root, plan };
}
/** Character CLI failures that are safe and useful to report (no absolute paths). */
function characterFailure(error: unknown): never {
  const message = (error as Error).message ?? "";
  const code = message.match(/^CLI_([A-Z_]+):/)?.[1];
  if (code === "OUTPUT_EXISTS") throw new Error("MCP_OUTPUT_EXISTS: choose a new output directory");
  if (code === "PNG_SIZE" || code === "PNG")
    throw new Error("MCP_PLAN_IMAGES: an image is missing, unreadable or not the layout's size");
  // Fit inputs (ADR-024, ADR-033), named without the workspace paths the CLI message holds.
  const fit: Record<string, string> = {
    FIT_FRAMES: "each picture needs its own frame inside the animation",
    FIT_VIEW: "the plan needs qa.view, and every picture its aspect ratio",
    FIT_ANIMATION: "the plan has no such animation",
    FIT_SLOTS: "ignore names a slot the layout does not have",
  };
  if (code && fit[code]) throw new Error(`MCP_${code}: ${fit[code]}`);
  // A video that cannot drive the build (ADR-036); these messages name no paths.
  if (code === "FIT_VIDEO")
    throw new Error(`MCP_FIT_VIDEO: ${message.slice(message.indexOf(": ") + 2).split("\n")[0]}`);
  if (code === "PLAN_QA" || code === "PLAN_SEARCH" || code === "COMPARE_ANIMATION")
    throw new Error(`MCP_${code}: ${message.slice(message.indexOf(": ") + 2).split("\n")[0]}`);
  // Comparison failures name animations, probes and parts, never paths.
  const reference = message.match(/^REFERENCE_([A-Z_]+): ([^\n]+)/);
  if (reference) throw new Error(`MCP_REFERENCE_${reference[1]}: ${reference[2]}`);
  // Engine failures carry a validation report (stage, code, reason) that safeFailure passes on.
  throw error;
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
export { chooseWorkspace, type WorkspaceChoice } from "./workspace.js";
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
        case "autospine_review_performance": {
          if (!Value.Check(toolSchemas.autospine_review_performance, args)) break;
          if (args.animation && args.keyStats)
            throw new Error("MCP_TOOL_ARGUMENTS: give animation or keyStats, not both");
          const keyStats = args.animation ? animationKeyStats(args.animation) : args.keyStats;
          return result(reviewPerformance(args.sample, args.profile, keyStats));
        }
        case "autospine_get_status": {
          // The development gates of the AutoSpine repository, only when the workspace is that
          // checkout; a plugin workspace has none, which says nothing about the engine.
          let status: unknown;
          try {
            status = JSON.parse(
              await readFile(resolve(this.workspace, "docs/reviews/GATE_5_17_STATUS.json"), "utf8"),
            );
          } catch {
            /* Optional in fixture/client workspaces. */
          }
          return result({
            version: AUTOSPINE_VERSION,
            ...(status === undefined ? {} : { status }),
            // Plans, images-only inputs, artist files and outputs must sit inside this folder.
            workspace: this.workspace,
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
              performanceCritic: "probe-metrics-vs-artist-statistics-n1",
              characterPlan: "plan-file-driven-images-only-rebuild-CharacterPlan-0.1",
              referenceCompare: "official-spine-core-4.0.31-runtime-pre-registered-criteria",
              motionOptimizer: "resumable-cyclic-coordinate-pattern-search",
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
        case "autospine_lint_character_plan": {
          if (!Value.Check(toolSchemas.autospine_lint_character_plan, args)) break;
          if (!Value.Check(CharacterPlanSchema, args.plan))
            return result(
              {
                valid: false,
                schemaErrors: [...Value.Errors(CharacterPlanSchema, args.plan)]
                  .slice(0, 20)
                  .map((e) => `${e.path || "/"}: ${e.message}`),
              },
              true,
            );
          const lint = lintCharacterPlan(args.plan, args.partNames);
          return result({ valid: !lint.errors.length, ...lint }, lint.errors.length > 0);
        }
        case "autospine_build_character": {
          if (!Value.Check(toolSchemas.autospine_build_character, args)) break;
          const { root, plan } = await guardPlan(this.workspace, args.planPath);
          const params = args.paramsPath
            ? await guardFile(root, args.paramsPath, 1024 * 1024)
            : undefined;
          const output = await guardOutput(root, args.outputDir, true);
          const lint = await lintPlanFile(plan).catch(characterFailure);
          if (lint.errors.length) return result({ valid: false, ...lint }, true);
          const built = await buildCharacterFiles(plan, output, params).catch(characterFailure);
          return result({
            ...built,
            output: relative(root, built.output),
            warnings: lint.warnings,
            artistQualityAccepted: false,
          });
        }
        case "autospine_compare_reference": {
          if (!Value.Check(toolSchemas.autospine_compare_reference, args)) break;
          const { root, plan } = await guardPlan(this.workspace, args.planPath);
          const build = await guardDirectory(root, args.buildDir);
          const artist = await guardFile(root, args.artistPath, 256 * 1024 * 1024);
          const output = await guardOutput(root, args.outputDir, true);
          const check = await compareReferenceFiles(plan, build, artist, output, {
            ...(args.animation === undefined ? {} : { animation: args.animation }),
          }).catch(characterFailure);
          return result({
            ...check,
            output: relative(root, output),
            scope: "pre-registered-numeric-acceptance-not-artist-approval",
            artistQualityAccepted: false,
          });
        }
        case "autospine_optimize_motion": {
          if (!Value.Check(toolSchemas.autospine_optimize_motion, args)) break;
          const { root, plan } = await guardPlan(this.workspace, args.planPath);
          const artist = await guardFile(root, args.artistPath, 256 * 1024 * 1024);
          const state = await guardOutput(root, args.stateDir, false);
          const run = await optimizeMotionFiles(plan, artist, state, {
            budgetSeconds: args.budgetSeconds ?? 120,
            ...(args.margin === undefined ? {} : { margin: args.margin }),
            ...(args.seed === undefined ? {} : { seed: args.seed }),
          }).catch(characterFailure);
          return result({ ...run, stateDir: relative(root, state), artistQualityAccepted: false });
        }
        case "autospine_review_video": {
          if (!Value.Check(toolSchemas.autospine_review_video, args)) break;
          const { root, plan } = await guardPlan(this.workspace, args.planPath);
          const build = await guardDirectory(root, args.buildDir);
          const artist = args.artistPath
            ? await guardFile(root, args.artistPath, 256 * 1024 * 1024)
            : undefined;
          const referenceVideo = args.referenceVideoPath
            ? await guardFile(root, args.referenceVideoPath, 2 * 1024 * 1024 * 1024)
            : undefined;
          const output = await guardOutput(root, args.outputPath, true);
          const video = await reviewVideoFiles(plan, build, artist, output, {
            ...(args.loops === undefined ? {} : { loops: args.loops }),
            ...(referenceVideo ? { referenceVideo } : {}),
          }).catch(characterFailure);
          return result({
            ...video,
            output: relative(root, output),
            artistQualityAccepted: false,
          });
        }
        case "autospine_compare_video": {
          if (!Value.Check(toolSchemas.autospine_compare_video, args)) break;
          const { root, plan } = await guardPlan(this.workspace, args.planPath);
          const build = await guardDirectory(root, args.buildDir);
          const video = await guardFile(root, args.videoPath, 2 * 1024 * 1024 * 1024);
          const output = await guardOutput(root, args.outputDir, true);
          const check = await compareVideoFiles(plan, build, output, {
            video,
            ...(args.animation === undefined ? {} : { animation: args.animation }),
            ...(args.start === undefined ? {} : { start: args.start }),
          }).catch(characterFailure);
          return result({
            pass: check.pass,
            animations: check.animations.map((a) => ({
              ...a,
              video: relative(root, a.video),
              output: relative(root, a.output),
              report: relative(root, a.report),
            })),
            outputDir: relative(root, output),
            artistQualityAccepted: false,
          });
        }
        case "autospine_reduce_keys": {
          if (!Value.Check(toolSchemas.autospine_reduce_keys, args)) break;
          const root = await realpath(resolve(this.workspace));
          const input = await guardFile(root, args.inputPath, 256 * 1024 * 1024);
          if (!/\.json$/i.test(input))
            throw new Error(
              "MCP_KEYS_INPUT: a Spine 4.0 JSON export is needed (.spine files go through the CLI)",
            );
          const baseline = args.baselinePath
            ? await guardFile(root, args.baselinePath, 256 * 1024 * 1024)
            : undefined;
          const images = args.imagesDir ? await guardDirectory(root, args.imagesDir) : undefined;
          const output = await guardOutput(root, args.outputDir, true);
          const summary = await reduceKeysFiles(input, output, {
            spine: false,
            video: args.video ?? false,
            ...(args.modes ? { modes: args.modes } : {}),
            ...(args.limits ? { limits: args.limits } : {}),
            ...(args.fps === undefined ? {} : { fps: args.fps }),
            ...(args.animations ? { animations: args.animations } : {}),
            ...(args.kinds
              ? {
                  kinds: args.kinds as ("bone" | "slot" | "ik" | "transform" | "path" | "deform")[],
                }
              : {}),
            ...(args.skip ? { skip: args.skip } : {}),
            ...(args.lock ? { lock: args.lock } : {}),
            ...(args.loops ? { loops: args.loops } : {}),
            ...(baseline ? { baseline } : {}),
            ...(images ? { images } : {}),
          }).catch((e: unknown) => {
            const m = (e as Error).message ?? "";
            if (/^CLI_KEYS_VERSION:/.test(m))
              throw new Error(`MCP_KEYS_VERSION: ${m.slice(m.indexOf(": ") + 2)}`);
            return characterFailure(e);
          });
          return result({
            outputDir: relative(root, output),
            sha256: summary.sha256,
            sourceUnchanged: summary.sourceUnchanged,
            runs: summary.runs.map((r) => ({ ...r, json: relative(root, r.json), spine: null })),
            preview: summary.preview ? relative(root, summary.preview) : null,
            notes: summary.notes,
            artistQualityAccepted: false,
          });
        }
        case "autospine_motion_draft": {
          if (!Value.Check(toolSchemas.autospine_motion_draft, args)) break;
          const { root, plan } = await guardPlan(this.workspace, args.planPath);
          const output = await guardOutput(root, args.outputPath, true);
          const drafted = await draftMotionFiles(plan, output, {
            animation: args.animation,
            ...(args.kind === undefined ? {} : { kind: args.kind }),
            ...(args.frames === undefined ? {} : { frames: args.frames }),
            ...(args.subject === undefined ? {} : { subject: args.subject }),
          }).catch(characterFailure);
          return result({ ...drafted, output: relative(root, output) });
        }
        case "autospine_merge_plans": {
          if (!Value.Check(toolSchemas.autospine_merge_plans, args)) break;
          const guarded = await Promise.all(
            args.planPaths.map((p) => guardPlan(this.workspace, p)),
          );
          const root = guarded[0]!.root;
          const output = await guardOutput(root, args.outputPath, true);
          const merged = await mergePlanFiles(
            output,
            guarded.map((g) => g.plan),
            {
              ...(args.id === undefined ? {} : { id: args.id }),
              ...(args.name === undefined ? {} : { name: args.name }),
            },
          ).catch(characterFailure);
          return result({ ...merged, output: relative(root, output) });
        }
        case "autospine_fit_pose": {
          if (!Value.Check(toolSchemas.autospine_fit_pose, args)) break;
          const { root, plan } = await guardPlan(this.workspace, args.planPath);
          const build = await guardDirectory(root, args.buildDir);
          // Exactly one of a rest-pose picture and key-pose pictures.
          if ((args.referencePath === undefined) === (args.references === undefined)) break;
          const picture = (path: string) => guardFile(root, path, 64 * 1024 * 1024);
          const references =
            args.referencePath !== undefined
              ? await picture(args.referencePath)
              : await Promise.all(
                  args.references!.map(async (r) => ({
                    frame: r.frame,
                    path: await picture(r.path),
                  })),
                );
          const output = await guardOutput(root, args.outputPath, true);
          const fit = await fitPoseFiles(plan, build, references, output, {
            ...(args.animation === undefined ? {} : { animation: args.animation }),
            ...(args.window === undefined ? {} : { window: args.window }),
            ...(args.maxRotate === undefined ? {} : { maxRotate: args.maxRotate }),
            ...(args.minCoverage === undefined ? {} : { minCoverage: args.minCoverage }),
            ...(args.ease === undefined ? {} : { ease: args.ease }),
            ...(args.ignore === undefined ? {} : { ignore: args.ignore }),
            ...(args.zeroFrame === undefined ? {} : { zeroFrame: args.zeroFrame }),
          }).catch(characterFailure);
          return result({ ...fit, output: relative(root, output), artistQualityAccepted: false });
        }
        case "autospine_fit_video": {
          if (!Value.Check(toolSchemas.autospine_fit_video, args)) break;
          const { root, plan } = await guardPlan(this.workspace, args.planPath);
          const build = await guardDirectory(root, args.buildDir);
          const video = await guardFile(root, args.videoPath, 2 * 1024 * 1024 * 1024);
          const output = await guardOutput(root, args.outputDir, true);
          const fit = await fitVideoFiles(plan, build, output, {
            video,
            ...(args.animation === undefined ? {} : { animation: args.animation }),
            ...(args.start === undefined ? {} : { start: args.start }),
            ...(args.rounds === undefined ? {} : { rounds: args.rounds }),
            ...(args.every === undefined ? {} : { every: args.every }),
            ...(args.ignore === undefined ? {} : { ignore: args.ignore }),
            ...(args.zero === undefined ? {} : { zero: args.zero }),
            ...(args.track === undefined ? {} : { track: args.track }),
            ...(args.lag === undefined ? {} : { lag: args.lag }),
          }).catch(characterFailure);
          return result({
            ...fit,
            video: relative(root, fit.video),
            inputs: fit.inputs.map((i) => ({ ...i, path: relative(root, i.path) })),
            best: {
              round: fit.best.round,
              dir: relative(root, fit.best.dir),
              plan: relative(root, fit.best.plan),
              build: relative(root, fit.best.build),
            },
            outputDir: relative(root, output),
            artistQualityAccepted: false,
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
        serverInfo: { name: "autospine", version: AUTOSPINE_VERSION },
        instructions:
          "Legacy MCP v1; chain-wave file build, explicit character IR compilation, in-memory engine tools (pose-table animation, feature meshes, dome/transfer/chain/gradient weights, overlap QA) and character plans (lint, build, compare with an artist baseline, motion optimisation). No live visual AI or artist approval. File tools require host authorization and workspace-local paths; builds and comparisons write new directories only.",
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
