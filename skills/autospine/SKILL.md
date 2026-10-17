---
name: autospine
description: Use the AutoSpine engines and local CLI or MCP tools to prepare PNG meshes, explicit rigs, weights and animation, review IK and controller plans, export editable Spine output, inspect evidence, or propose bounded rebuilds. Use for AutoSpine production workflows and disclose each tool's supported scope.
---

# AutoSpine

Keep the agent as an operator of existing engines, not a replacement geometry algorithm. Begin from the actual checkout, current job, and [engineering status](../../docs/reviews/GATE_5_17_STATUS.json). Read [MCP tool details](../../docs/MCP_ADAPTER.md) only when connecting or choosing a tool. This project bundle is not proof of global skill discovery or desktop MCP registration.

## Choose the supported workflow

For a character request spanning bones, mesh topology, weights, IK, controllers or animation, read [the production workflow and capability map](references/production-workflow.md). This skill coordinates all stages; execute through available MCP/CLI tools and existing engines. Package APIs, a baked constraint pose and native editable Spine constraints are distinct capabilities. Check the actual supported profile before promising a complete character build.

For part classification, joint inference, topology, weights or facial deformation, read [rig and deformation rules](references/rig-deformation.md). For IK, controller spaces, contact, motion, expressions, FX, transitions or delivery, read [controls and animation rules](references/controls-animation.md). These rules were distilled after all 76 local tutorial ASR transcripts were read; historical editor/runtime limitations and ASR errors are not current capability claims.

- For progress or diagnosis, use `autospine_get_status` and existing evidence; do not build or publish merely because the user asked a question.
- For a file build, the currently exposed profile is `chain-wave`: one connected alpha region, with **explicit** chain endpoints and bone count. Use the artist-split PNG, not artist scoring mesh/bone answers. Missing composition or anatomical information is a real input gap; do not manufacture confident joint coordinates.
- For an assembled character with an explicit control plan, use `autospine_compile_character`: region/weighted-mesh IR, convex clipping, bone animations, attachment visibility, RGBA and weighted deform keys, native one/two-bone IK and local/world absolute/relative Transform with signed mixes and offsets. It returns JSON in memory; the host saves into a new directory and the official version-matched CLI creates the editable project. Read the capability map for unsupported channels. This is not a PNG-only anatomy model or the `chain-wave` file builder.
- For artist-level deformation and timing, read [the engine pipeline](references/engine-pipeline.md) and use the in-memory engine tools before compiling. They cover face parallax, eyelids, limb seams, riding glows and eased pose-to-pose motion: `autospine_feature_mesh`, `autospine_measure_dome`, `autospine_dome_weights`, `autospine_gradient_weights`, `autospine_chain_weights`, `autospine_transfer_weights`, `autospine_build_keypose_animation` and `autospine_measure_overlap`. They return JSON and write nothing. Main beat timing, bone placement and source choices remain plan inputs. Their numbers are QA evidence, not artist approval.
- For a whole character or prop from a Spine file (the request the [user guide](../../docs/USER_GUIDE.md) describes):
  - Export JSON with the official CLI and run `strip-images` into a new folder.
  - Confirm the brief: animation and length, which pose set it shows, held props versus hands resting on scenery, prop sway size, blinks and looks. When the setup stacks several pose sets, also ask for a picture of the rest pose. For a one-shot (entry, exit, win), ask for a few key-pose pictures with frame numbers (storyboard or reference-video frames, start and end included): a name alone only guesses the motion. Ask only for what is missing.
  - Lay out the skeleton by [the template](references/engine-pipeline.md) (ADR-025): every bone from its joint to the next, legs on a squashed stance, soft strands and ornaments as chains.
  - Mesh every shown part (`meshing: { all: true }`), and when there is a rest-pose picture, run `autospine_fit_pose` and put its `pose` in the plan (ADR-024).
  - With key-pose pictures, build the one-shot without guessed big moves, run `autospine_fit_pose` with `references` (`zeroFrame: 0` when the frame-0 picture is the rest pose) and put its `keyposes` in the animation (ADR-033); the plan's breath, follows and waves stay on top. Report each picture's coverage and `unused` parts: expressions, mesh deforms (a tongue), scaling and hands moved off their arms are not fitted.
  - With a reference video of the motion (an artist render or a Spine export of it), ask whether to follow it or only compare. To follow it, build the plan, then run `autospine_fit_video` instead of the name templates (ADR-036), or set `reference.use: "fit"` for `deliver`; key-pose pictures (ADR-033) remain for storyboards. Report the rounds, the period and stretch, the key density against the prior and the `hints` (parts not fitted). Label the result reference-fitted, never blind. A generated clip that redraws the figure stays compare-only.
  - Write a character plan and follow [the plan runbook](../../docs/CHARACTER_PLAN.md): `autospine_lint_character_plan` until clean, then `autospine_build_character`.
  - Always finish with `autospine_review_video` (wireframe, bones, motion). When an artist version exists, also run `autospine_compare_reference`, and `autospine_optimize_motion` if D1/D2 fail (CLI: `lint-plan`, `build-character`, `review-video`, `compare-reference`, `optimize-motion`).
  - Start motion from the measured priors (ADR-032), not from guesses: `loopRecipe` and `oneShotTemplate` in `@autospine/motion` give the idle, walk and prop recipes and the one-shot keys; [the engine pipeline](references/engine-pipeline.md) lists the medians, ranges and how many arts each rests on. A brief or a reference overrides them.
  - When one character has several animations planned apart, merge the plans with `autospine_merge_plans` (CLI `merge-plans`) and build once: one Spine project with every animation (ADR-031). Give its one-shots one shared pivot.
  - Hand over the Spine JSON, its images, `HANDOVER.md` (bones by role, constraints, what each animation keys, where to edit), the video and any acceptance result. The plan is data: joint rules over part pixels, bones, meshes, weights, constraints and motion blocks. Report optimizer results against an artist version as benchmark-tuned, and keep the editor round trip and artist approval separate.
- For an in-memory plan, use `autospine_validate_plan` then `autospine_execute_plan`. Validation is not approval: `reviewRequired` or confidence below 0.8 blocks automatic execution. File compilation uses a separate host-approved BuildJob; planner proposals cannot supply filesystem paths.
- For a correction, use measured evidence with `autospine_review_metrics`, then `autospine_apply_correction`. It may reduce wave amplitude or regenerate weights/wave, never directly replace vertices, bones or weights. Corrections must match the current asset, manifest and input fingerprint. Unresolved seams require review; successful numeric rebuilding is not artist-quality acceptance.

## Build and hand off

Use `autospine_build` only for an authorized write into a **new** output directory within the host-configured workspace. Do not retry over existing outputs or alter original artwork. The engine produces the preview, versioned IR references, diagnostics and provenance. Inspect the actual preview and manifest-bound hashes before presenting visual claims. A render alone is not a direct visual review; an IR preview is not official editor playback.

If MCP is unavailable, use the existing CLI, not a rewritten engine:

```text
npm run build
node packages/cli/dist/index.js build <approved-job.json>
```

Job/schema details are in [the project quick start](../../README.md). Character input uses `CharacterSpineInputSchema` in the Spine adapter. Use existing Mesh and Weight engines, restrict deform influences to the intended part, and use `solveChainWeights` only for an explicit connected chain with a bounded joint blend band. Check whether a short flexible arm needs a stretchable single-bone control or a two-bone elbow; do not accept inverted triangles merely to retain a guessed joint. Constraints, presets and humanoid templates are deterministic APIs, not proof of automatic anatomical inference.

## Evidence and boundaries

For real character rig inference or deformation review, read [the application knowledge baseline](../../docs/SPINE_APPLICATION_KNOWLEDGE.md) and [the tutorial-derived engineering notes](../../docs/SPINE_TUTORIAL_ENGINEERING_NOTES.md). Treat foreground-supported image paths as candidate evidence; they do not require every control bone or mesh vertex to lie inside opaque pixels. Choose control chains from part function and intended motion, and verify the assembled deformation. The tutorial notes distinguish observed frames from proposed engine changes; they do not expand the supported `chain-wave` file-build profile.

The Planner provider is a structured proposal port and the current Critic is numeric. Neither proves live vision-model accuracy. Keep local engineering checks, official Runtime/editor round-trip, private artist comparison and independent reviewer approval separately labelled. Latest user authority controls the acceptance process; old workflow text does not override a newer decision. Do not silently lower thresholds, reuse artist answers, call a paid model or upload private images to obtain a green label.

Git publication, paid reviews, client registration and global skill installation are separate authorized actions, not side effects of building. Preserve unrelated changes; publish only an explicitly reviewed source allowlist. Do not claim quota monitoring or delayed continuation unless the product tool has actually saved that automation.

For workflow changes, consult [the architecture](../../ARCHITECTURE.md) and [per-Gate criteria](../../docs/GATE_5_17_AUTONOMOUS_PLAN.html). Keep the Core independent of this skill and MCP. [Decision cases](decision-cases.json) record reference operator choices and their real tool checks; they are not a trained intent classifier or independent model evaluation.
