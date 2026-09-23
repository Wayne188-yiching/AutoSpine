# AutoSpine Architecture

## Purpose

AutoSpine automates repeatable 2D rigging and animation preparation while preserving Spine as the final artist-facing editor.

## Boundaries

```text
Skill / AI Planner
        |
        v
Validated AutoSpine IR
        |
        v
Deterministic Core Engines
        |
        v
Adapter (Spine first)
        |
        v
Editable target data
```

The Core must accept manually authored IR and complete a build without AI. MCP and Skill are callers of the Core, never Core dependencies.

## Intermediate representation

The initial IR consists of:

- `AssetSpec`
- `MeshSpec`
- `RigSpec`
- `WeightSpec`
- `ConstraintSpec`
- `AnimationSpec`
- `BuildManifest`
- `ValidationReport`

Each schema is versioned, runtime-validatable, statically typed, serializable, and target-engine neutral. Spine JSON is not an internal data model.

## Package responsibilities

| Location         | Responsibility                                                              |
| ---------------- | --------------------------------------------------------------------------- |
| `schemas`        | Runtime schemas and TypeScript types for the IR                             |
| `packages/core`  | Stable engine-neutral facade over the IR and future deterministic engines   |
| `packages/spine` | Spine-specific adapter boundary; no compiler exists in Gate 0               |
| `tests`          | Cross-package contracts and runtime schema checks                           |
| `fixtures`       | Small, reviewable inputs and golden outputs introduced by their owning Gate |

## Dependency direction

```text
schemas
   ^
   |
core
   ^
   |
spine adapter

AI / MCP / Skill -> core
```

Future engine packages may depend on `schemas` and approved lower-level engine contracts. Circular dependencies and manager-style catch-all services are prohibited.

## Validation and errors

Runtime schema validation protects stage boundaries. Domain validators are added only in the Gate that owns the relevant semantics. For example, a schema can require numeric weights in Gate 0; checking that they sum to one belongs to the Weight Validator in Gate 5.

Every future domain error must identify its code, stage, target, reason, and possible action. Generic errors such as `Something went wrong` are not acceptable.

## Determinism

The same input, specification, configuration, and seed must produce the same output. Time, filesystem order, locale, and uncontrolled randomness must not affect build artifacts.

## Spine boundary

Spine 4.3 is the first compatibility target. Gate 1 must establish compatibility from official documentation, official runtimes, the Spine CLI, and a real export before implementing the compiler. Unverified format details belong in `ASSUMPTIONS.md`, never silently in code.

## Current implementation boundary

Gate 0 contains contracts and tooling only. Geometry, weighting, constraints, animation generation, compilation, AI, MCP, Skill, preview rendering, and GUI behavior remain intentionally absent.
