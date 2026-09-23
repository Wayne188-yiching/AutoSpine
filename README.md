# AutoSpine

AutoSpine is an AI-assisted 2D rigging and animation automation engine. It is designed to automate repeatable preparation work before an artist completes the final polish in Spine.

The project follows one rule above all others:

```text
AI planning + deterministic execution
```

The deterministic Core must work without an AI model. AI may choose templates and parameters, but it does not calculate triangles, weights, transforms, interpolation, or Spine serialization.

## Current status

Gate 0 establishes the repository, architecture, versioned intermediate representation, validation schemas, development tooling, and Gate 1 plan. It intentionally contains no Spine compiler, mesh generation, weight solving, AI, MCP, Skill, or GUI implementation.

See:

- [Development workflow](AUTOSPINE_DEVELOPMENT_WORKFLOW.md)
- [Architecture](ARCHITECTURE.md)
- [Roadmap](ROADMAP.md)
- [Spine application knowledge](docs/SPINE_APPLICATION_KNOWLEDGE.md)
- [Gate 1 plan](docs/GATE_1_PLAN.md)

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
```

## Repository layout

```text
packages/core/    Engine-neutral IR facade
packages/spine/   Spine adapter boundary; compiler starts in Gate 1
schemas/          Runtime schemas and inferred TypeScript types
tests/            Cross-package validation tests
fixtures/         Versioned test assets added gate by gate
docs/adr/         Architecture decision records
```

## License

Private and unlicensed. No permission is granted to copy, distribute, or use this repository outside its authorized development context.
