# Assumptions

Assumptions are explicit, reviewable, and temporary. Verified facts should be moved to the appropriate architecture, research, or knowledge document.

## Gate 0 assumptions

1. Node.js 22.12+ and npm workspaces are acceptable for the first implementation.
2. TypeBox 0.x LTS is an acceptable single source for JSON Schema-compatible runtime schemas and inferred TypeScript types.
3. Schema version `0.1` identifies the initial pre-MVP IR and may change through an explicit migration and ADR.
4. IDs are non-empty strings. A canonical naming and path policy will be defined by the Gate that first needs it.
5. Coordinates and angles are engine-neutral numbers in Gate 0. Coordinate origin, axis direction, units, and angle conventions must be decided before Gate 1 compiler implementation.
6. Runtime schemas validate data shape. Semantic invariants such as triangle topology, parent cycles, weight sums, and loop continuity belong to their stage-specific validators.
7. Spine 4.3 is the target, but its exact JSON representation remains unverified until the research and real-export work in Gate 1.
8. No CLI application is created in Gate 0 because there is no executable engine behavior yet. CLI-first remains the delivery strategy starting with the first real command surface.

## Open questions for Gate 1

- Which exact Spine 4.3 patch and runtime snapshot define compatibility?
- What coordinate, angle, omission, and default-value conventions are present in a real Spine 4.3 export?
- What minimum artifact set can the Spine CLI import and inspect successfully?
