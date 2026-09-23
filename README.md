# AutoSpine

AutoSpine is an AI-assisted 2D rigging and animation automation engine. It is designed to automate repeatable preparation work before an artist completes the final polish in Spine.

The project follows one rule above all others:

```text
AI planning + deterministic execution
```

The deterministic Core must work without an AI model. AI may choose templates and parameters, but it does not calculate triangles, weights, transforms, interpolation, or Spine serialization.

## Current status

Gates 0 through 3.2 are approved. Gate 3.2 was repaired after the owner required each mesh to stay within +/-20% of its matching original artist attachment: beard is now 24/24 vertices and house is 25/25, with matched outer/interior distributions. The final [Gate 3.2 Jev review](docs/reviews/GATE_3_2_RECHECK_5.json) approved the static topology evidence after 50 tests; deformation quality remains for later Gates. Prior rejected reviews remain in `docs/reviews/` for audit. The [development workflow](AUTOSPINE_DEVELOPMENT_WORKFLOW.md) holds the current status and exact Jev token usage.

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
```

Gate 3.2 adds optional `--intent=chain|rigid|unknown` and `--reference-profile=profile.json` to both mesh commands. The profile is a small numeric JSON object with `vertices`, `hull`, and optional `bands` (`position` and `widthFraction` between zero and one); it contains no Spine coordinates. Use an explicit `chain` hint for the previously approved Tail use case and `rigid` for a confirmed non-deforming part. The default is `unknown`, never inferred from filenames; it produces a sparse geometric starter and a review warning. CLI diagnostics always state that deformation is unverified and report skinny triangles. Programmatic callers can use `generateMeshWithDiagnostics`; the existing `generateMesh` API and MeshSpec schema remain available. These hints do not supply bones, weights, or joint-aware topology.

Developer-only private reference checks: `node tools/mesh-reference-check.mjs <private-config.json> <external-output-dir>`. The config contains `runs` (100 for acceptance), `cleanupFraction`, and `cases` with `id`, `png`, optional `options.intent`, and optional `skeleton`/`slot`/`attachment` identifying an exact-size exported Spine mesh. It reports independent raster coverage, angles, validation and repeatability, and writes a small `<id>.profile.json` for reuse with `--reference-profile`. Outputs inside this repository are rejected. Optional `tools/plot-mesh-comparison.py` renders those exact coordinates with Pillow; Python/Pillow are not Engine or CI dependencies. Keep configurations, artwork, exported skeletons and plotted meshes outside Git.

## Repository layout

```text
packages/core/    Engine-neutral IR facade
packages/spine/   Minimal Spine 4.0.64 adapter
packages/assets/  PNG Parts and PSD asset parsers
packages/mesh/    Deterministic alpha contour, triangulation, and MeshSpec validator
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
