# AutoSpine

AutoSpine is an AI-assisted 2D rigging and animation automation engine. It is designed to automate repeatable preparation work before an artist completes the final polish in Spine.

The project follows one rule above all others:

```text
AI planning + deterministic execution
```

The deterministic Core must work without an AI model. AI may choose templates and parameters, but it does not calculate triangles, weights, transforms, interpolation, or Spine serialization.

## Current status

Gates 0, 1, and 2 are approved. Gate 2 parses PNG Parts and clean raster PSDs into AssetSpec; Jev acceptance and limits are recorded in the development workflow and [Gate 2 review](docs/reviews/GATE_2_REVIEW.json). Mesh generation, weight solving, AI, MCP, Skill, and GUI remain out of scope.

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
```

## Repository layout

```text
packages/core/    Engine-neutral IR facade
packages/spine/   Minimal Spine 4.0.64 adapter
packages/assets/  PNG Parts and PSD asset parsers
packages/cli/     Thin file-based commands
schemas/          Runtime schemas and inferred TypeScript types
tests/            Cross-package validation tests
fixtures/         Versioned test assets added gate by gate
docs/adr/         Architecture decision records
```

For PNG Parts, an optional manifest supplies canvas size, part positions, display dimensions, hierarchy and back-to-front `drawOrder`. Without one, only a deterministic flat import is possible: filenames sort by codepoint and positions default to `(0, 0)`. The parser never guesses the original composition. Both asset commands refuse to overwrite an existing output file; PSD source files are never modified. See [Gate 2 architecture](ARCHITECTURE.md#current-implementation-boundary) for supported PSD features and limits.

## License

Private and unlicensed. No permission is granted to copy, distribute, or use this repository outside its authorized development context.
