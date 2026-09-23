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

| Location          | Responsibility                                                              |
| ----------------- | --------------------------------------------------------------------------- |
| `schemas`         | Runtime schemas and TypeScript types for the IR                             |
| `packages/core`   | Stable engine-neutral facade over the IR and future deterministic engines   |
| `packages/assets` | Gate 2 PNG Parts and clean raster PSD parsers into AssetSpec                |
| `packages/mesh`   | Gate 3 deterministic alpha contour, triangulation, and mesh validation      |
| `packages/spine`  | Spine-specific adapter; Gate 1 minimal 4.0.64 compiler                      |
| `packages/cli`    | Thin file-based commands that call the packages                             |
| `tests`           | Cross-package contracts and runtime schema checks                           |
| `fixtures`        | Small, reviewable inputs and golden outputs introduced by their owning Gate |

## Dependency direction

```text
schemas <- core
schemas <- assets
schemas <- mesh
schemas <- spine adapter
assets + mesh + spine adapter <- CLI

AI / MCP / Skill -> core (future Gates)
```

Future engine packages may depend on `schemas` and approved lower-level engine contracts. Circular dependencies and manager-style catch-all services are prohibited.

## Validation and errors

Runtime schema validation protects stage boundaries. Domain validators are added only in the Gate that owns the relevant semantics. For example, a schema can require numeric weights in Gate 0; checking that they sum to one belongs to the Weight Validator in Gate 5.

Every future domain error must identify its code, stage, target, reason, and possible action. Generic errors such as `Something went wrong` are not acceptable.

## Determinism

The same input, specification, configuration, and seed must produce the same output. Time, filesystem order, locale, and uncontrolled randomness must not affect build artifacts.

## Spine boundary

Spine 4.0.64 is the first compatibility target. Gate 1 evidence combines official documentation, a real editor export, the official 4.0 runtime, and Spine CLI import/export. Details and limits are in `docs/research/SPINE_FORMAT_RESEARCH.md`.

## Current implementation boundary

Gate 2 adds only asset parsing. PNG Parts can use a manifest for canvas dimensions, layer order, display dimensions, and hierarchy; without a manifest, filenames are sorted and positions default to zero because a directory has no composition metadata. Clean 8-bit RGB raster PSDs preserve top-to-bottom layer identity, group hierarchy, visibility, bounds, and alpha. `AssetSpec.drawOrder` is zero for the backmost part. `alphaMask` is exact 8-bit alpha in run-length encoding; `pivotCandidate` is the center of the nonzero-alpha bounds, scaled into display coordinates, not an inferred anatomical joint. PSD part `sourcePath` uses `<source.psd>#layer/<index-path>` as a stable source reference, not an extracted PNG path. No source image is changed.

Text, adjustment, vector, masked, effected, blended, clipped, non-8-bit and non-RGB PSD layers are rejected rather than silently flattened.

Gate 3 takes one part's exact Gate 2 alpha mask and display bounds. It traces exposed pixel-cell edges, removes exact collinear points, then tries bounded contour simplification only when the resulting polygon remains simple. Ordinary parts may miss/add no more than 1% of corrected foreground raster cells each; elongated low-poly parts may miss/add no more than 2% each. It triangulates the single-region contour, samples a sparse five-point major-axis centerline for elongated parts (a bounded uniform interior grid otherwise), flips internal edges only when the adjacent triangles' minimum angle improves, and independently validates MeshSpec topology. Coordinates use top-left raster origin with positive y downward; output vertices scale into display bounds, while UVs use the full PNG raster. `hull` is the ordered possibly concave outer boundary, not a convex hull. The Mapbox Earcut library supplies candidate triangles, but its own documentation says triangulation is not guaranteed for arbitrary invalid input, so AutoSpine validates both input contour and output mesh. Optional preprocessing has a single explicit changed-pixel fraction budget and reports discarded/fill counts. It never edits source pixels. Holes or detached regions beyond the budget are errors; no AI chooses topology.

Gate 3 does not add weights, bones, constraints, animation, Spine mesh serialization, preview rendering, or GUI behavior. Its mesh is an engine-neutral intermediate result, not a production-ready rig.

Gate 3.2 permits an optional, engine-neutral `referenceTopology` argument to `generateMesh`: total and hull counts plus dimensionless interior cross-section bands. The private developer reference tool reads an exported matching Spine attachment and derives those numbers outside `packages/mesh`; the Mesh engine only receives numbers and builds vertices against the current alpha raster. No Spine parser, source JSON, artist XY coordinates, Jev SDK, or new runtime dependency enters Mesh, Core or schemas. The CLI's existing mesh commands remain file-based; a missing reference uses the starter mesh path and requires review. `MeshSpec-0.1` is unchanged. A package-boundary test checks the Mesh dependency and import direction.
