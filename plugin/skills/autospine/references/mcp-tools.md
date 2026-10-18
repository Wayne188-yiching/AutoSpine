<!-- Generated from docs/MCP_ADAPTER.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# AutoSpine MCP adapter

Gate 16 provides an actual local stdio server, not a placeholder or duplicated rig engine. It supports **legacy MCP v1** versions 2025-11-25 and 2025-06-18. Modern `server/discover` deliberately returns method-not-found for legacy client fallback; this is not a 2026 stateless protocol implementation.

Build first with `npm run build`. A host may launch:

```text
node C:/Wayne/Codex/AutoSpine/packages/mcp/dist/stdio.js
```

Set the host-controlled `AUTOSPINE_WORKSPACE` environment variable to the intended workspace, otherwise the server uses its working directory. This release does **not** register itself in Codex, modify client configuration, install globally, or launch a persistent background process.

| Tool                                | Effect                                                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `autospine_compile_character`       | Compile explicit character IR, RGBA/deform, convex clipping and native IK/Transform in memory                                            |
| `autospine_get_status`              | Read current engineering status and capability limitations                                                                               |
| `autospine_validate_plan`           | Validate explicit proposal; disclose low-confidence review requirement                                                                   |
| `autospine_execute_plan`            | Compute and measure an approved-confidence plan in memory only                                                                           |
| `autospine_build`                   | Read a strict BuildJob and write its outputs into a **new** workspace-local directory                                                    |
| `autospine_review_metrics`          | Numeric defects to bounded CorrectionSpec; no visual AI call                                                                             |
| `autospine_apply_correction`        | Fingerprint-bound immutable in-memory rebuild, then remeasure                                                                            |
| `autospine_feature_mesh`            | Mesh a part by its silhouette with locked rings around enclosed holes (ADR-016)                                                          |
| `autospine_measure_dome`            | Measure a face dome field and its fold limit from part alpha (ADR-012)                                                                   |
| `autospine_dome_weights`            | Dome (parallax) weights with optional pinned regions; dome values at points                                                              |
| `autospine_transfer_weights`        | Closest-point weight transfer onto a riding mesh such as a glow (ADR-013)                                                                |
| `autospine_chain_weights`           | Joint-plane chain weights with per-joint blend widths (ADR-014)                                                                          |
| `autospine_gradient_weights`        | Linear two-bone gradient for eyelids, jaws and flaps (ADR-015)                                                                           |
| `autospine_build_keypose_animation` | Pose table plus timing rules to a sparse, curved AnimationSpec (ADR-011)                                                                 |
| `autospine_measure_overlap`         | Posed seam drift between two meshes and inversions per mesh; numeric QA                                                                  |
| `autospine_lint_character_plan`     | Schema errors, then cross-reference lint of a character plan in memory (ADR-017)                                                         |
| `autospine_build_character`         | Lint and build a workspace plan into a **new** workspace directory (Spine JSON, IR, record)                                              |
| `autospine_compare_reference`       | Artist-baseline comparison and pre-registered acceptance into a **new** workspace directory                                              |
| `autospine_optimize_motion`         | Resumable motion-parameter search for at most `budgetSeconds` in a workspace state directory                                             |
| `autospine_review_video`            | **New** MP4: artist \| build with wireframe, then bones, then motion (needs ffmpeg)                                                      |
| `autospine_compare_video`           | **New** directory: the build against a workspace reference video, V1–V4 rows, hints and reference \| build \| difference video (ADR-034) |
| `autospine_fit_pose`                | **New** JSON: a rest pose fitted to a PNG of `qa.view` (ADR-024), or key poses fitted to pictures on frames (`references`, ADR-033)      |
| `autospine_merge_plans`             | **New** plan: plans of one character merged, every animation keeping its motion (ADR-031)                                                |
| `autospine_fit_video`               | **New** directory: one animation's motion fitted to a workspace reference video in rounds; `best/` holds the lowest penalty (ADR-036)    |

The eight engine tools after `autospine_apply_correction` run the ADR-010..016 engines on caller-supplied IR (parts with alpha masks, meshes, rigs, weights, pose tables) and return JSON. They read no files and accept no paths. Bone placement, dome bones, chain membership, transfer sources and main beat timing stay with the caller's plan. `autospine_feature_mesh` places vertices in the coordinates given by `part.bounds`; the weight, dome and overlap tools work in world (image Y-down) coordinates. Engine failures come back as `isError` results with the engine's stage code (for example `DOME_BONES`, `KEYPOSE_DRIVER`); a part without an alpha mask gives `MCP_PART_ALPHA`. Their results carry `artistQualityAccepted: false` where they describe quality. [The operator pipeline](engine-pipeline.md) gives the order, starting parameters and measured reference values.

The nine character-plan tools (ADR-017, ADR-024, ADR-031, ADR-033, ADR-034, ADR-036, ADR-039, [runbook](character-plan.md)) take workspace-relative paths. The plan, the images-only file and image folder it names, a parameters file, the artist baseline and every output must stay inside the configured workspace, by the same lexical and real-path checks as `autospine_build`. Builds and comparisons refuse existing output directories (`MCP_OUTPUT_EXISTS`). A video that cannot drive a fit (its frame 0 does not draw the build's images, or it is too short) comes back as `MCP_FIT_VIDEO` before anything is fitted. The optimizer resumes from its own state directory and returns `paused` until it passes or converges. A plan that does not lint comes back as an `isError` result listing the problems, and engine failures carry their stage code (for example `PLAN_JOINT`, `PLAN_MOTION_TIMING`). Results carry `artistQualityAccepted: false`.

Only `autospine_build` and the character file tools write files. A client should obtain authorization for that mutation; annotations are advisory, not a permission grant. The adapter contains no upload, paid API, Git publication or credential tool. No private images are sent over a network.

The file builder uses the explicit **chain-wave** profile. The additional character compiler accepts a caller-supplied `CharacterSpineInputSchema` from `@autospine/spine`; it does not read source files or write outputs. Its geometry, rig and weights must come from the engine IR. It supports region attachments (including attachment tint), weighted meshes, a bounded simple convex clipping polygon, multiple baked bone rotation/translation/scale animations, attachment name/null and slot RGBA timelines, weighted mesh deform offsets, native one/two-bone IK (including one-bone compress/stretch) and local/world absolute/relative Transform with signed mixes from -1 to 1 and explicit offsets. It rejects descendant targets, invalid update order, broken selections, unsupported region shear, crossing/degenerate clipping edges and clipping end slots before the mask. Limits include 256 bones, 512 slots and 64 animations. Native Path, event/draw-order/constraint-animation timelines and automatic anatomical inference are not provided by this profile.

Deform keys in the top-level `deformTimelines` field refer to an existing slot and weighted mesh attachment, with one image/world setup-space `[dx,dy]` per MeshSpec vertex. The adapter converts each offset through the influence's inverse bind basis, packs offsets in Spine's hull-first weighted order and changes Y direction. These are explicit offsets supplied by the host, not automatic facial inference. `colorTimelines` keys contain RGBA hex colors. Bone, color and deform keys may carry an optional normalized `curve` (`linear`, `stepped` or `bezier` handles) for the segment to the next key; the adapter writes Spine 4.0 absolute handles and rejects a curve on a final key ([ADR-010](adr/ADR-010-key-interpolation-curves.md)). Convex `clipping` attachments contain `boneId`, `endSlotName` and 3..64 world-space vertices in the engine's image Y-down coordinates; the clipping bone must match its slot.

The stdio default remains 1 MiB per request. A host can set `AUTOSPINE_MCP_MAX_MESSAGE_MIB` to an integer from 1 through 16 for large explicit character IR. Invalid values fall back to 1 MiB. This changes the transport bound only, not BuildJob/path permissions or the schema limits.

The 2026-10-08 private character pilot called this tool through a real initialized local stdio subprocess, saved new outputs and validated official Spine 4.0.64 import/export. It is not evidence of desktop MCP registration or final artist-quality acceptance. The character Runtime tests cover mirrored regions and weighted deform bases, engine skinning, IK/Transform order and reverse local follow, hand scale, visibility/RGBA and fixed scene clipping under a moving/scaled character. New channels also completed an official 4.0.64 character import/export; this remains separate from artistic acceptance.

## Scope and protocol checks

Job, PNG and new output must remain inside the configured workspace, using lexical and real-path checks including parent junction escapes. Job files are limited to 64 KiB. The existing CLI owns no-overwrite staging, PNG/resource validation, compilation and provenance. These guards are not a security sandbox for concurrently hostile filesystem changes. External asset directories are not silently whitelisted; use an explicitly authorized local working copy when needed, leaving originals intact.

UTF-8 JSON-RPC is newline-delimited, capped at the host-selected 1..16 MiB per message (default 1 MiB), processed sequentially and stdout contains only protocol JSON. Initialization and `notifications/initialized` precede tools. Notifications cannot invoke mutation tools. Protocol errors and `isError` tool results are distinct; filesystem error details and raw private arguments are not echoed. The subprocess tests cover actual construction, existing-output rejection, recovery after malformed/oversized messages and junction escape rejection.

Engineering self-review is not live model evaluation, automatic artist approval or proof of a configured desktop client connection.

Primary protocol references: [legacy transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [legacy lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), [legacy tools](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-11-25/server/tools.mdx).
