# AutoSpine

AutoSpine is an AI-assisted 2D rigging and animation automation engine. It is designed to automate repeatable preparation work before an artist completes the final polish in Spine.

The project follows one rule above all others:

```text
AI planning + deterministic execution
```

The deterministic Core must work without an AI model. AI may choose templates and parameters, but it does not calculate triangles, weights, transforms, interpolation, or Spine serialization.

## Current status

Gates 0 and 1 are approved. Gate 1 implements the minimal Spine 4.0.64 compiler and thin CLI, with a real editor-exported fixture, official 4.0 runtime load test, and Spine CLI round trip. Mesh generation, weight solving, AI, MCP, Skill, and GUI remain out of scope. Gate acceptance is tracked in the development workflow.

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
```

## Repository layout

```text
packages/core/    Engine-neutral IR facade
packages/spine/   Minimal Spine 4.0.64 adapter
packages/cli/     Thin compile-minimal command
schemas/          Runtime schemas and inferred TypeScript types
tests/            Cross-package validation tests
fixtures/         Versioned test assets added gate by gate
docs/adr/         Architecture decision records
```

## License

Private and unlicensed. No permission is granted to copy, distribute, or use this repository outside its authorized development context.
