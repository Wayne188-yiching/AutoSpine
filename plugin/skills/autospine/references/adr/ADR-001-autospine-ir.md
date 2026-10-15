<!-- Generated from docs/adr/ADR-001-autospine-ir.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# ADR-001 — AutoSpine Intermediate Representation

Status: Accepted  
Date: 2026-09-23

## Context

Using Spine JSON as the Core data model would couple every engine to one external format and make validation, testing, migrations, and future adapters harder.

## Decision

AutoSpine owns a versioned, engine-neutral IR. The initial contracts are AssetSpec, MeshSpec, RigSpec, WeightSpec, ConstraintSpec, AnimationSpec, BuildManifest, and ValidationReport. Runtime schemas are the source of TypeScript types.

## Alternatives

- Use Spine JSON throughout the system.
- Use unversioned TypeScript interfaces without runtime validation.
- Build a generic scene graph before concrete requirements exist.

## Consequences

- Engines exchange explicit, testable contracts.
- Adapters translate the IR to target formats.
- Schema changes require migration decisions.
- Some data must be translated even when Spine uses a similar representation.
