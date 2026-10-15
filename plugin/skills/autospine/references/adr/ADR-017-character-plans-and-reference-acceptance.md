<!-- Generated from docs/adr/ADR-017-character-plans-and-reference-acceptance.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# ADR-017 — character plans, orchestration and reference acceptance

Context: the Yuuna rebuild (F1–F4, 2026-10-09) reached every automatable acceptance criterion, but only through private, per-character scripts. The orchestration (a joint-placement script, a motion spec, an optimizer, a comparison and a criteria check) lived outside the repository, and every decision was code: which pixels define a joint, which images share a bone chain, which mesh and weight engine each image gets, every motion beat and timing rule. The engines underneath (ADR-010..016) were already deterministic and tested. A second character would have needed a new script, and a cheaper model could not have run the workflow without editing code.

Decision:

- **`CharacterPlan-0.1`** (`schemas/src/character-plan.ts`) holds every character-specific decision as data:
  - Joints are geometric rules over part pixels or other joints: `centroid`, `center`, `overlap`, `end`, `axisEnd`, `lerp`, `project`, `narrowest`, `domeCenter`, and `point` for scene anchors only.
  - Bones (`at` / `to` / `angle`) and strand chains (`chain`), the face dome (`face`), and `meshes` (feature / contour / surface / quad) with their weights (chain / gradient / dome / transfer / rigid).
  - `regions`, native IK and Transform `constraints`, and `motion`: one main sink cycle, beats, sink-derived legs / face / squash, follow, waves, cycles and keyed props.
  - Motion parameters, search ranges, and QA probes, seams and deformation exclusions.
  - Numbers can be literals, `$param`, `-$param`, or `=expressions`. Expressions are evaluated by a recursive-descent parser, never `eval`.
- **`@autospine/character`** is pure orchestration: an images-only layout plus a plan become engine IR, then Spine 4.0 JSON. It reads no files and loads no runtime.
  - It solves the joints and places each bone relative to its parent.
  - It meshes and weights each image, adds rigid quads for sheared placements, and builds IK, Transform and face-follower constraints.
  - Motion blocks become `KeyposeSpec`s, which `buildKeyposeAnimation` (ADR-011) turns into animations and `compileCharacterSpine40` compiles.
  - `lintCharacterPlan` checks cross-references before any pixels are read: joints and cycles, bone order, part names, mesh order, constraint bones, control ids, parameter references and expressions, search ranges, and whether every image has a mesh or a region bone.
- **`readImagesOnlyLayout`** in the Spine adapter reads an images-only document: one root bone, regions, and bare quads for sheared placements.
- **`@autospine/reference`** holds acceptance against an artist baseline. It loads the official `@esotericsoftware/spine-core` **4.0.31** runtime, pinned exactly.
  - `stripToImagesOnly` produces the input copy.
  - The comparison covers setup placement, sampled slot motion, recall / precision / amplitude, deformation QA (visible inversions and character stretch), performance-critic bands derived from the artist's own metrics (the P2-h critic), structure statistics and rasterised contact sheets.
  - `checkAcceptance` applies the pre-registered thresholds below.
  - `makeObjective` and a resumable cyclic pattern search tune a plan's `motion.search` parameters.
- **CLI:** `strip-images`, `lint-plan`, `build-character`, `compare-reference` and `optimize-motion`.
  - Outputs go to new directories only. The optimizer is the exception: it resumes from its state directory.
  - Exit codes: 2 when lint or acceptance fails; 3 when the optimizer has paused and should be called again; 4 when it converged without passing.
- **MCP:**
  - `autospine_lint_character_plan`: in memory, read-only.
  - `autospine_build_character`, `autospine_compare_reference` and `autospine_optimize_motion`: workspace-guarded. The plan, its images-only file, its image folder, the parameters, the artist baseline and every output must resolve inside the configured workspace by lexical and real-path checks.

Pre-registered acceptance (freeze-F1, unchanged since the Yuuna F1 build):

| Id  | Criterion                                  | Threshold        |
| --- | ------------------------------------------ | ---------------- |
| A1  | Images-only fit to the artist setup        | ≤ 2 px           |
| A2  | Generated setup vs images-only placement   | ≤ 0.5 px         |
| A4  | Loop seam per animation                    | ≤ 0.5 px         |
| B1  | Visible inversions (alpha > 25 %)          | 0                |
| B2  | Seam drift of the plan's QA pairs          | ≤ 11 px          |
| B3  | Character stretch                          | ≤ 1.5 × artist   |
| C1  | Attachments (region + mesh + linked mesh)  | = artist         |
| C2  | Motion recall                              | ≥ 0.8            |
| C3  | Motion precision                           | ≥ 0.7            |
| D1  | Performance critic within the artist bands | ≥ 60 %           |
| D2  | Amplitude within ×/÷ 2                     | ≥ 60 %           |
| A5  | Editor import/export round trip            | manual, separate |
| E   | Artist approval                            | manual, separate |

Evidence:

- **Regression on private data.** The Yuuna plan (21 KB: 66 bone entries, 44 joints, 28 meshes, F4's q7 parameters) and the new packages reproduce the F4 deliverable:
  - 89 bones and 77 slots. Bones, slots, skins (vertices and weights), constraints and every animation key are equal within 10⁻³ relative.
  - At zero tolerance, 38 values differ by at most 4.4 × 10⁻¹⁶, all in the two plant cycles.
  - Every number in `compare-reference`'s results equals F4's within 10⁻⁶; only the profile labels changed.
  - Results: A2 0.014 px, B2 2.311 px, D1 21/22 and 20/22, D2 0.907 and 0.932.
  - Timings: build 3.7 s, comparison 27 s, optimizer about 0.26 s per evaluation.
- **Optimizer behaviour.**
  - With `bandShrink` 0 the optimizer's internal critic equals the official one (21/22, 20/22). The default 5 % shrink is deliberately conservative (17/22, 16/22).
  - A seeded, deliberately strict search moved the penalty from 333 to 93 in 437 evaluations.
  - A resumed run continued from its saved state.
- **Synthetic tests.** A drawn seven-image character (`tests/character-fixture.ts`) carries no private art:
  - `character-plan.test.ts`: schema, expression parser, lint, joints from pixels, motion blocks, timing and region errors, determinism, and official-runtime placement ≤ 0.01 px.
  - `character-reference.test.ts`: strip back to images-only, sheared quads, a build compared with itself passing every criterion, and an objective that ranks departures worse and searches back.
  - `character-files.test.ts`: CLI files and exit codes, the lint gate, and the MCP tools with output-exists and workspace-escape refusals.
- **Package boundaries.** `package-boundaries.test.ts` keeps `character` free of `node:`, the runtime and the planner, and keeps the pinned runtime in `reference`.

Limits:

- F4's parameters are **benchmark-tuned**: the optimizer used the artist baseline. Reproducing F4 proves the engine port, not blind generalisation.
- A new character's plan is still authored by a person or model from slot names and composition. The plan is data rather than code, but choosing which rule fits which part is a judgement. For example, `axisEnd` is undefined on round parts; use `end` with a direction.
- Without an artist baseline, only lint, build, setup placement, seams and loop checks apply.
- The editor round trip (A5) and artist approval (E) remain separate. Numeric acceptance is not artistic approval.

Consequences: a character is now a plan file plus its images. Other characters, scripted runs and cheaper models edit data, lint it and call four commands. Rollback: remove the two packages, the schema, the layout reader, the CLI commands and the four MCP tools. The engines below are unchanged.
