# Assumptions

Assumptions are explicit, reviewable, and temporary. Verified facts should be moved to the appropriate architecture, research, or knowledge document.

## Gate 0 assumptions

1. Node.js 22.12+ and npm workspaces are acceptable for the first implementation.
2. TypeBox 0.x LTS is an acceptable single source for JSON Schema-compatible runtime schemas and inferred TypeScript types.
3. Schema version `0.1` identifies the initial pre-MVP IR and may change through an explicit migration and ADR.
4. IDs are non-empty strings. A canonical naming and path policy will be defined by the Gate that first needs it.
5. Coordinates and angles are engine-neutral numbers in Gate 0. Coordinate origin, axis direction, units, and angle conventions must be decided before Gate 1 compiler implementation.
6. Runtime schemas validate data shape. Semantic invariants such as triangle topology, parent cycles, weight sums, and loop continuity belong to their stage-specific validators.
7. Gate 0 originally assumed Spine 4.3; the user changed the first target to Spine 4.0.64 for Gate 1. Minimal JSON representation is now verified in `docs/research/SPINE_FORMAT_RESEARCH.md`.
8. No CLI application is created in Gate 0 because there is no executable engine behavior yet. CLI-first remains the delivery strategy starting with the first real command surface.

## Remaining questions beyond the Gate 1 minimal slice

- How should arbitrary asset-canvas coordinates map to Spine bone-local attachment offsets? Gate 1 requires an explicit binding offset and does not infer pivots.
- Which additional 4.0.64 fields and attachment types are needed for Mesh, Weight, and Constraint Gates? The minimal fixture does not establish a complete 4.0.64 JSON schema.
