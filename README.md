# AutoSpine

Deterministic 2D mesh, rig and animation preparation, with editable Spine output. AI may later choose parameters; the engines work without AI.

## Current development

2026-10-05 latest owner instruction: develop sequentially through Gate 17 with assistant self-acceptance and a GitHub checkpoint after each completed engineering Gate. Gate 5 is self-accepted; further Gates are in progress. The chain-wave build connects PNG → blind mesh → explicit chain → distance weights → baked wave → weighted Spine 4.0 output and local preview. Historical artist calibration remains unchanged.

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

## Publication and boundaries

Each completed engineering Gate is committed/pushed after local verification and recorded assistant self-review under the latest owner override. Private artwork, original projects, artist coordinates, videos, comparison screenshots and credentials stay excluded. This does not mean Jev approval or artist-quality acceptance. Missing scheduling tools are recorded as limitations, not fabricated automations.

[Architecture](ARCHITECTURE.md) · [Roadmap](ROADMAP.md) · [Affine/tool contract ADR](docs/adr/ADR-007-toolchain-and-affine-ir.md)

## License

Private and unlicensed. Spine runtime/editor use remains subject to Esoteric Software's license.
