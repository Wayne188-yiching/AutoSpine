# ADR-028 — feature mesh outline fallbacks

Context: building the BigBadWolf walk plans (2026-10 batch blind test) hit three outlines the feature mesher refused, both in its default mode and with an artist budget:

- **A face plate with large detached fur tufts.** The default mode keeps the main component and refuses to drop more than 2 % of the foreground (`DISCARD_BUDGET`).
- **Large, ragged gloves and a chest.** About 700–1100 px images whose pixel outlines have more than 2048 corners (`CONTOUR_INVALID`).
- **A hand drawn in two strokes** whose pixels touch only at a corner (not 4-connected).

Decision:

- When dropping detached pieces would exceed the budget, the default mode joins them with 3 px bridges into one outline, as the budget mode already does (ADR-024).
- When the full-resolution outline cannot be traced, it is traced on a coarser grid. Each cell is the union of a k × k block, with k = 2, 3 and so on up to 15. Coordinates scale back up, so the outline still covers every pixel.

Evidence:

- `tests/mesh-outline-fallback.test.ts`: a 1200 px ragged disc meshes in both modes with its rim covered, and two squares meeting at a corner mesh as one.
- `tests/character-restpose.test.ts`: the default mode now wraps two separate eyes.
- All three SoccerWolf and WildWolf rigs build.

Consequences:

- Parts that used to stop a build now mesh. On a very ragged outline the hull sits up to k pixels outside the opaque edge.
- Rollback: restore the primary-component refusal and the single trace.
