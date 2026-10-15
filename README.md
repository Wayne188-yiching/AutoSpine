# AutoSpine

Deterministic 2D mesh, rig and animation preparation, with editable Spine output. AI may later choose parameters; the engines work without AI.

**使用者請先看 [使用說明](docs/USER_GUIDE.md)；安裝外掛（Claude Code、Cowork、Codex）見 [安裝指南](docs/INSTALL.html)。**

The `plugin/` folder is the installable AutoSpine plugin for Claude and Codex: the skill, a single-file bundle of the engine and MCP server, and a runnable example. This repository is its marketplace (`.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`). After changing engines or documents, run `npm run build:plugin` and raise the plugin version; `tests/plugin-package.test.ts` fails while the plugin is out of date.

## Current development

2026-10-12: **character plans (ADR-017).** The private Yuuna scripts are now repository packages: `@autospine/character` (plan → rig, meshes, weights, constraints, motion, Spine JSON; pure) and `@autospine/reference` (official 4.0.31 runtime: strip to images-only, compare with an artist version, pre-registered acceptance, resumable motion search). Five CLI commands and four MCP tools drive them from one plan file per character, so another character or a cheaper model edits JSON instead of code. The private Yuuna plan reproduces the F4 deliverable exactly (max difference 4.4 × 10⁻¹⁶) and its acceptance numbers (D1 21/22 and 20/22). F4 is benchmark-tuned, not blind; editor round trip and artist approval remain separate. See the [plan reference and runbook](docs/CHARACTER_PLAN.md).

2026-10-07: the owner delegated judgement to the assistant. All 44 hair/limb outputs have now been assessed: **8 image paths passed / 36 failed / 0 pending**. Thirteen candidates were individually inspected; eight follow the intended part, while five require corrections for sharp turns, endpoint spurs, ornament bias or combining calf and shoe. The other 31 have no usable path (28 unresolved multi-region inputs and three transparent slice centers), and are explicitly failed at this stage. All 169 use classifications remain accepted; the other 125 identities remain pending as not started in the all-material view. Two foreground connections were repaired with bounded routing inside the original PNG; both still failed visual review. The original eleven paths are unchanged. Affected checks pass 29/29; seven unchanged connection checks retain prior passing evidence. Image-path acceptance is assistant judgement under user delegation; no anatomical rig or deformation quality has passed.

2026-10-05 owner acceptance: all 169 displayed image-and-filename classifications are accepted; the 22 earlier name/visual differences remain as history. This acceptance does not cover target masks, joints, roots, bone counts or rig quality. Geometry workers still receive anonymous PNG pixels only. A new longitudinal-slice path experiment covers all 44 hair/limb images: 11 supported image-path candidates, 28 multi-region images requiring target selection, and 5 rejected for transparent slice centers or segments. All 169 identities remain recorded. The 11 PNG overlays were inspected; silhouette-edge bias and connected accessories remain limitations. All 33 targeted checks pass. No rigs or anatomical joints have been accepted. Original visual reports, classification acceptance and frozen source snapshots remain available through the local review.

2026-10-05 continuation: real-material PNG-only rig inference. An independent local development batch preserves all 169 mesh identities / 159 opaque PNGs and reference snapshots; verification covers 167 files and the complete export denominator. Codex has visually inspected all 159 anonymous images: 66 clear-content, 42 tentative and 51 unknown image-level role proposals, with unmeasured accuracy. This is an exploratory visual review, not a validated standalone semantic model or certified blind evaluation. PNG-only connection evidence finds end cues in 113 images, width asymmetry in 57 and raster-border contact in 99; 11 clear single-region hair/limb images are candidates for local shape experiments. Width asymmetry and border contact do not establish joints or roots. All 25 targeted checks pass; target regions, pivots, parents and bone counts remain unconfirmed. No bones have been generated or accepted. The owner reports the original 23-case manifest is probably on another computer; local Yuuna has 73 meshes versus the historical 68. The original 0/23 rig-quality result remains unchanged. See the latest workflow entry and the local-only review linked from the Gate status page.

2026-10-05 latest owner instruction: develop sequentially through Gate 17 with assistant self-acceptance and a GitHub checkpoint after each completed engineering Gate. Gates 5–17 now have implemented engineering scopes and recorded self-reviews. Planner / Critic acceptance covers validated contracts and numerical corrections, **not live visual AI**. The chain-wave file build connects PNG → blind mesh → explicit chain → distance weights → baked wave → weighted Spine 4.0 output and local preview. Engine APIs also expose bounded humanoid templates, constraints, smoothing and ten animation presets. Historical artist calibration remains unchanged.

- [Gate status and acceptance](GATE_STATUS.html)
- [Gate 5–17 plan and criteria](docs/GATE_5_17_AUTONOMOUS_PLAN.html)
- [Current engineering progress](docs/reviews/GATE_5_17_STATUS.json)
- [Unattended continuation checkpoint](docs/AUTONOMOUS_DEVELOPMENT.md)
- [Authoritative workflow and historical evidence](AUTOSPINE_DEVELOPMENT_WORKFLOW.md)
- Claude's supplied review remains local: `docs/DEV_REVIEW_2026-10-05.html`.

## Quick start

Requires Node.js >=22.12 and npm 12.

```text
npm install
npm run build
node fixtures/chain-wave/create-demo.mjs <new-demo-directory>
node packages/cli/dist/index.js build <new-demo-directory>/job.json
```

Open the generated `build/preview.html`. Import `build/skeleton.json` into Spine 4.0.64; keep `build/images/image.png` alongside it.

The demo generates synthetic test art, not user assets. The job explicitly supplies chain endpoints and bone count; automatic anatomical inference is not implemented. Paths are relative to the job file. Builds refuse existing output directories. Failed staging directories remain recoverable and are not silently deleted.

## Build job

```json
{
  "schemaVersion": "0.1",
  "kind": "build-job",
  "id": "fish",
  "name": "Fish",
  "profile": "chain-wave",
  "source": "fish.png",
  "output": "new-build",
  "cleanupFraction": 0.005,
  "chain": { "start": [25, 40], "end": [140, 40], "boneCount": 5 },
  "wave": { "duration": 2, "fps": 24, "amplitudeDegrees": 8, "phaseDegrees": 45 }
}
```

One connected alpha region; supported cleanup is explicitly budgeted. The starter slice limits input to four million pixels and 250,000 sampled vertex positions. Output contains Asset/Mesh/Rig/Weight/Animation specs, build manifest, diagnostics, Spine JSON, PNG and an animated IR preview. Metrics are measured samples, not human-quality acceptance.

## Character plans

```text
node packages/cli/dist/index.js strip-images <artist.json> <images-dir> <new imagesOnly.json>
node packages/cli/dist/index.js lint-plan <plan.json>
node packages/cli/dist/index.js build-character <plan.json> <new-output-dir> [--params=p.json]
node packages/cli/dist/index.js compare-reference <plan.json> <build-dir> <artist.json> <new-output-dir>
node packages/cli/dist/index.js optimize-motion <plan.json> <artist.json> <state-dir> [--budget=s]
node packages/cli/dist/index.js review-video <plan.json> <build-dir> [<artist.json>] <new-video.mp4>
```

One plan file per character holds the joint rules, bones, meshes, weights, constraints, motion blocks and QA probes; the [runbook](docs/CHARACTER_PLAN.md) gives each step, exit code and pitfall. Acceptance thresholds and evidence are in [ADR-017](docs/adr/ADR-017-character-plans-and-reference-acceptance.md).

Legacy commands remain available: `parse-png`, `parse-psd`, `mesh-png`, `mesh-asset`, `rig-chain`, `compile-minimal`. See the workflow and [architecture](ARCHITECTURE.md) for their narrower historical contracts.

## Verification

```text
npm run verify
```

This checks formatting, lint, build/types, Vitest contracts and Node portable diagnostics. It does not regenerate the private 164/23-case artist corpus, run paid Jev calls or certify editor GUI playback. Real editor CLI import/re-export is separately recorded.

## Agent tools

Gate 16's [local legacy stdio MCP adapter](docs/MCP_ADAPTER.md) provides twenty-three tools: explicit multi-part character compilation in memory, status, validated plans, scoped file builds, numeric review, immutable corrections, eight in-memory engine tools for feature meshes, dome/transfer/chain/gradient weights, pose-table animation and overlap QA, and seven character-plan tools (lint in memory; workspace-scoped build, artist comparison, motion search, review video, rest-pose fitting and merging the plans of one character into one project). After building, a host can launch `node packages/mcp/dist/stdio.js` with `AUTOSPINE_WORKSPACE` set to its authorized working directory. No desktop client configuration is automatically modified.

Gate 17's [AutoSpine project Skill](skills/autospine/SKILL.md) operates those existing tools or the CLI. It includes observable reference decision cases, not another geometry solver. It is bundled in this repository; global installation and automatic discovery are not claimed. File builds currently expose only explicit chain-wave; a template function is not image-based anatomical inference.

## Publication and boundaries

Each completed engineering Gate is committed/pushed after local verification and recorded assistant self-review under the latest owner override. Private artwork, original projects, artist coordinates, videos, comparison screenshots and credentials stay excluded. This does not mean Jev approval or artist-quality acceptance. Missing scheduling tools are recorded as limitations, not fabricated automations.

[Architecture](ARCHITECTURE.md) · [Roadmap](ROADMAP.md) · [Affine/tool contract ADR](docs/adr/ADR-007-toolchain-and-affine-ir.md)

## License

Private and unlicensed. Spine runtime/editor use remains subject to Esoteric Software's license.
