# AutoSpine

Deterministic 2D mesh, rig and animation preparation, with editable Spine output. AI may later choose parameters; the engines work without AI.

## Current development

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

Legacy commands remain available: `parse-png`, `parse-psd`, `mesh-png`, `mesh-asset`, `rig-chain`, `compile-minimal`. See the workflow and [architecture](ARCHITECTURE.md) for their narrower historical contracts.

## Verification

```text
npm run verify
```

This checks formatting, lint, build/types, Vitest contracts and Node portable diagnostics. It does not regenerate the private 164/23-case artist corpus, run paid Jev calls or certify editor GUI playback. Real editor CLI import/re-export is separately recorded.

## Agent tools

Gate 16's [local legacy stdio MCP adapter](docs/MCP_ADAPTER.md) provides six tools for status, validated plans, scoped file builds, numeric review and immutable corrections. After building, a host can launch `node packages/mcp/dist/stdio.js` with `AUTOSPINE_WORKSPACE` set to its authorized working directory. No desktop client configuration is automatically modified.

Gate 17's [AutoSpine project Skill](skills/autospine/SKILL.md) operates those existing tools or the CLI. It includes observable reference decision cases, not another geometry solver. It is bundled in this repository; global installation and automatic discovery are not claimed. File builds currently expose only explicit chain-wave; a template function is not image-based anatomical inference.

## Publication and boundaries

Each completed engineering Gate is committed/pushed after local verification and recorded assistant self-review under the latest owner override. Private artwork, original projects, artist coordinates, videos, comparison screenshots and credentials stay excluded. This does not mean Jev approval or artist-quality acceptance. Missing scheduling tools are recorded as limitations, not fabricated automations.

[Architecture](ARCHITECTURE.md) · [Roadmap](ROADMAP.md) · [Affine/tool contract ADR](docs/adr/ADR-007-toolchain-and-affine-ir.md)

## License

Private and unlicensed. Spine runtime/editor use remains subject to Esoteric Software's license.
