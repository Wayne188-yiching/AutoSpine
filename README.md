# AutoSpine

AutoSpine is an AI-assisted 2D rigging and animation automation engine. It is designed to automate repeatable preparation work before an artist completes the final polish in Spine.

The project follows one rule above all others:

```text
AI planning + deterministic execution
```

The deterministic Core must work without an AI model. AI may choose templates and parameters, but it does not calculate triangles, weights, transforms, interpolation, or Spine serialization.

## Current status

2026-10-03 publication checkpoint: the owner explicitly requested pushing the current progress to GitHub. This authorizes a source-only progress snapshot despite Gate 3.2 remaining incomplete, superseding the earlier wait-for-Gate-3.2 publication condition for this push only. Gate 3.2 remains deferred at 23/164; Gate 4's precision refinement is approved; Gate 5 is not started. Private artwork, original Spine projects, videos, comparison screenshots and credentials remain excluded. The snapshot includes the Gate status page, portable Gate 4 skeleton view, review records and in-development Gate 3.2 code; it is not a claim of complete project acceptance.

- [Gate 完成狀態總覽](GATE_STATUS.html)：每個 Gate 的目前狀態與驗收入口。
- [Gate 4 最新驗收報告](docs/reviews/gate-4-precision/review.html)：數值精度修補已通過新版 Jev 正式驗收。
- [Gate 4 骨鏈示範與範圍](docs/reviews/gate-4-resume/review.html)：首次恢復工作的通用直線骨鏈範例。
- [Gate 3.2 完整圖像驗收報告](docs/local-reviews/gate-3.2-collapse-20/review.html)：本機報告，23／164 完整靜態通過，尚未完成 Gate 驗收。

Earlier on 2026-10-03, the owner deferred Gate 3.2 due to expected token cost and explicitly moved current work to Gate 4. Gate 3.2 remains reopened at 23/164 complete static passes, not approved. At that stage, the exception changed the Gate 4 work order only; Gate 5 and the earlier full-Gate-3.2 condition for GitHub publication were unchanged. The initial resume reused the existing straight-chain approval and passing evidence and added a numeric CLI example, not weights or artwork binding.

The owner subsequently selected GPT-6.1 Sol High for a scoped Gate 4 development-agent trial. Other Gates and historical Jev approvals retain their recorded models; the coordinating chat is not automatically switched. The [actual trial record](docs/research/GATE_4_SOL61_TRIAL.md) documents a new extreme-coordinate floating-point limitation; no engine changes or historical test reruns were made for this trial.

Following the owner's request to optimize Gate 4 through acceptance, the designated GPT-6.1 Sol High agent added a minimal numeric precision guard. The refinement passed 19 targeted rig/CLI tests, 13 new review-policy tests and four distinct independent numeric audits; unaffected historical tests were not rerun. After explicit authorization for this new payload and paid call, Jev formally [approved the refinement](docs/reviews/GATE_4_PRECISION_DECISION.json) on 2026-10-03: APPROVED probability 0.98, evidence quality 3.99/4, all unchanged mandatory thresholds passed. See the [acceptance record](docs/research/GATE_4_PRECISION_ACCEPTANCE.md). Publication was separately authorized afterward; Gate 5 work has not started.

Gates 0–4 each have a historical Jev approval, but Gate 3.2 is **reopened** against the primary Yuuna/panda/pig projects, with Tutorial as supporting evidence. The current criteria include per-attachment absolute ±5 vertices, artist-used foreground and same-attachment padding checks, position comparisons, and separate manual-solid versus automatic-dashed edge review. Gate 4's independent straight [ChainRigTemplate](docs/reviews/GATE_4_REVIEW.json) approval is historical and does not waive Gate 3.2; Gate 5 remains on hold. Previous [Gate 3.2 Jev approval](docs/reviews/GATE_3_2_RECHECK_5.json) is historical under the superseded scope. Private comparison images are excluded from Git; the local review copy lives in `docs/local-reviews/`. See the [development workflow](AUTOSPINE_DEVELOPMENT_WORKFLOW.md) for current status.

2026-09-30: the authorized [Jev design decision](docs/reviews/GATE_3_2_DESIGN_DECISION.json) selected the shared v5 geometric/typed-edge policy. Local sources were freshly exported and retested: 16/164 complete static passes, with 100-run evidence for those 16 only; 125 portable tests pass. The new explicit constraint API is not automatic feature extraction, and Gate 3.2 remains unapproved. See the [implementation and evidence record](docs/research/GATE_3_2_ASTRA_JEV_07.md).

See:

- [Development workflow](AUTOSPINE_DEVELOPMENT_WORKFLOW.md)
- [Architecture](ARCHITECTURE.md)
- [Roadmap](ROADMAP.md)
- [Spine application knowledge](docs/SPINE_APPLICATION_KNOWLEDGE.md)
- [Gate 1 plan](docs/GATE_1_PLAN.md)
- [Spine 4.0.64 evidence](docs/research/SPINE_FORMAT_RESEARCH.md)

## Requirements

- Node.js 22.12 or newer
- npm 12 or newer

## Commands

```bash
npm install
npm run build
npm run lint
npm run test
npm run verify
npm run compile:minimal -- compile-minimal fixtures/spine/minimal/input.json output.json
npm run parse:png -- path/to/png-parts output.json [manifest.json]
npm run parse:psd -- path/to/layered.psd output.json
npm run mesh:png -- path/to/tail.png mesh.json [cleanup-fraction]
npm run mesh:asset -- asset.json mesh.json part-id [cleanup-fraction]
npm run rig:chain -- chain-input.json rig.json
```

For `rig:chain`, the input JSON is `{ "id": "tail", "name": "Tail", "start": [0, 0], "end": [0, 120], "boneCount": 5 }`. It produces an equal-length, parent-first `RigSpec` starter chain; it does not infer pivots, bind artwork, calculate weights or produce a final Spine scene. Input is preserved and existing output is not overwritten.

The Gate 4 precision refinement checks every reconstructed world joint and the final tip with chain-length-normalized error <=`1e-10`. Numerically unrepresentable chains throw structured `RIG_NUMERIC_PRECISION` errors without writing output; endpoints and bone lengths are never adjusted to hide the error. Exact large-coordinate chains remain allowed. This is a JavaScript Number input-domain policy, not a claim about all runtime precisions. See the [current precision acceptance report](docs/reviews/gate-4-precision/review.html); this refinement has its own new Jev approval rather than automatically extending the historical approval.

Gate 3.2 adds optional `--intent=chain|rigid|unknown` and `--reference-profile=profile.json` to both mesh commands. The profile is a small numeric JSON object with `vertices`, `hull`, and optional `bands` (`position` and `widthFraction` between zero and one); it contains no Spine coordinates. Use an explicit `chain` hint for the previously approved Tail use case and `rigid` for a confirmed non-deforming part. The default is `unknown`, never inferred from filenames; it produces a sparse geometric starter and a review warning. CLI diagnostics always state that deformation is unverified and report skinny triangles. Programmatic callers can use `generateMeshWithDiagnostics`; the existing `generateMesh` API and MeshSpec schema remain available. These hints do not supply bones, weights, or joint-aware topology.

Developer-only private reference checks: `node tools/mesh-reference-check.mjs <private-config.json> <external-output-dir>`. The config contains `runs` (100 for acceptance), `cleanupFraction`, and `cases` with `id`, `png`, optional `options.intent`, and optional `skeleton`/`slot`/`attachment` identifying an exact-size exported Spine mesh. It reports independent raster coverage, angles, validation and repeatability, and writes a small `<id>.profile.json` for reuse with `--reference-profile`. Outputs inside this repository are rejected. Optional `tools/plot-mesh-comparison.py` renders those exact coordinates with Pillow; Python/Pillow are not Engine or CI dependencies. Keep configurations, artwork, exported skeletons and plotted meshes outside Git.

The matched-artist profile may additionally include `maxAddedFraction`: measured transparent pixels inside the SAME artist hull divided by that attachment's effective foreground. It replaces only the added-area budget, not the missed-foreground limit. The private corpus checker explicitly selects original foreground pixels inside the artist hull; this is **reference-conditioned generation**, not independent semantic segmentation. It enforces missed effective foreground <=2%, generated transparent pixels <=artist transparent pixels, and no inclusion of original foreground excluded by the artist. Original/effective/excluded pixel counts are reported, and the precheck independently re-derives the region from the original PNG. The ordinary CLI does not perform this private reference-region selection; profiles without the new field and the Tail path keep existing behavior. `node tools/reference-corpus-check.mjs <private-config.json> <new-external-output-dir>` and `node tools/render-reference-review.mjs <report.json> <private-config.json>` produce current corpus evidence and screenshots-ready HTML; old reports cannot satisfy the current Gate.
For a matched artist reference, the checker also distinguishes the exported hull and artist-authored solid edges from dashed automatic triangle sides; counts alone do not pass the topology review. The private corpus checker described above additionally enforces the owner's reference-conditioned foreground and padding limits. Gate 3.2 remains reopened until the full same-source review passes.

An optional `referenceTopology.family` (`strip-spine` or `strip-ladder`) explicitly selects a bounded strip construction. It requires same-attachment counts and `maxAddedFraction`, and cannot be combined with `bands`. The solver uses alpha-derived bilateral silhouette fitting, interval regularity and budgeted widening, then creates real structural edges. It reports unsupported counts, excessive work, or failed pixel budgets instead of silently falling back. Unspecified families keep the previous path. Private audits may opt into `referenceStructureFamilies: true`: a developer-only classifier reduces validated reference connectivity to a coarse family label, never transferring reference coordinates or edge indices into the engine. This remains reference-conditioned generation, not independent semantic recognition. See `docs/research/GATE_3_2_STRUCTURE_11.md` for structural-family evidence and limitations.

Optional `rasterRegion: { sourceAlpha, targetAlpha }` keeps original source foreground separate from selected foreground before cleanup. It requires an explicit `referenceTopology.maxAddedFraction`; target foreground must be a nonempty subset of source foreground. A bounded final fit moves only hull points, at most 1.5 PNG pixels, preserving counts, interior points and typed connectivity. It checks zero excluded-foreground overlap, at most 2% missed target foreground and the same-attachment transparent-padding budget. Unfit regions throw explicit errors; a failing search above `hull.length² * height > 1,000,000` (row-prefix sums remove width from per-candidate work) is blocked, not silently accepted. No region option leaves the old path unchanged. `fitRasterRegion` exposes the same operation for an already-valid mesh and its display bounds. Private audits enable it through `rasterRegionConstraints: true`; this is reference-region conditioning, not artist-coordinate copying or unseen-image segmentation.

Region constraints, the Astra floating-point correction, full-corpus results and remaining failures are recorded in `docs/research/GATE_3_2_REGION_15.md`. Portable tests are not formal Gate acceptance.

Optional `boundaryDecimation: true` requires `rasterRegion` and same-attachment reference counts/padding. It only reduces boundary-only meshes with no manual edges, trying low-area vertex removals and rebuilding triangles under unchanged pixel budgets. Interior/strip topology and the default path are preserved. Work is bounded to 64 initial vertices, 150,000 pixels, hull-count squared times height at most 1,000,000, and 128 removal attempts; an exhausted search retains its last valid mesh, which still needs independent count, position and typed-edge acceptance. Repeated fitting has no cumulative 1.5-pixel displacement guarantee. Private corpus checks enable the same `boundaryDecimation` flag; no artist coordinates, edge indices or comparison scores choose a candidate.

A stalled deletion search may now try at most 64 adjacent-midpoint merges, only if its deletion budget is not exhausted. The same pixel and topology validation applies, and reaching the target count bypasses this fallback. The incremental evidence record in `docs/research/GATE_3_2_COLLAPSE_20.md` distinguishes three regenerated cases from unchanged-path evidence; it does not claim a new full-suite run or full Gate acceptance.

## Repository layout

```text
packages/core/    Engine-neutral IR facade
packages/spine/   Minimal Spine 4.0.64 adapter
packages/assets/  PNG Parts and PSD asset parsers
packages/mesh/    Deterministic alpha contour, triangulation, and MeshSpec validator
packages/rig/     Deterministic straight chain RigSpec generator
packages/cli/     Thin file-based commands
schemas/          Runtime schemas and inferred TypeScript types
tests/            Cross-package validation tests
fixtures/         Versioned test assets added gate by gate
docs/adr/         Architecture decision records
```

For PNG Parts, an optional manifest supplies canvas size, part positions, display dimensions, hierarchy and back-to-front `drawOrder`. Without one, only a deterministic flat import is possible: filenames sort by codepoint and positions default to `(0, 0)`. The parser never guesses the original composition. Both asset commands refuse to overwrite an existing output file; PSD source files are never modified. See [Gate 2 architecture](ARCHITECTURE.md#current-implementation-boundary) for supported PSD features and limits.

Gate 3 mesh commands are strict by default: disconnected alpha, holes, and corner pinches fail with structured errors. An explicit `cleanup-fraction` such as `0.005` permits at most 0.5% combined pixel changes to select the primary region and repair tiny pinches/holes; the CLI prints exact counts. Input images are never rewritten. On Windows, a UNC path containing parentheses may need the direct form `node packages/cli/dist/index.js mesh-png ...` because npm's command wrapper can alter the path.

## License

Private and unlicensed. No permission is granted to copy, distribute, or use this repository outside its authorized development context.
