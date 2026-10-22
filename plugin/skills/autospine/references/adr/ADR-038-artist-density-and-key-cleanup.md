<!-- Generated from docs/adr/ADR-038-artist-density-and-key-cleanup.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# ADR-038 — artist-density meshes and key cleanup by default

Status: Accepted
Date: 2026-10-17

## Context

The Pig quality v3 build (2026-10-17, compared with the artist file; not blind) passed every A–D row, yet two things an artist would see first were far from artist work:

- **Mesh density.** 69 meshes with 6,045 vertices, against the artist's 54 meshes with 1,379: 88 vertices a mesh against 26. The body (`1_body`) had 160 vertices on a regular lattice; the artist's has 33.
- **Key density.** Every one of the 215–259 bone timelines was keyed, 11–12 keys a second each (appear 3,422 keys, win 15,646), against the artist's 1.1–2.9 keys a second (266 and 1,187). An artist editing it would have to move a key on almost every frame.

Causes:

- A planned `feature` mesh without `density` used the engine's fine lattice: hull edges of √(area) / 16 px and an interior lattice spacing of √(area / 48) px. That gives about 100 vertices whatever the image size (96–100 on ellipses from 80 × 60 to 700 × 600 px; more on a ragged outline). The skill told deforming parts (body, face) to use that default. ADR-024's artist budget only applied to `meshing.all` region parts and to `density: "artist"`.
- Key poses (ADR-033) are added to the procedural motion by `addTracks`, which splits a segment down to single frames where one curve cannot follow the sum. Key poses on many frames (pictures fitted frame by frame) keep a key on every frame of every bone they touch. The procedural motion alone is sparse: the fixture idle has 1.1–3.8 keys a second per timeline.

## Decision

- **Meshes**: a planned `feature` mesh has the artist budget by default (ADR-024: s = √(width × height) px, hull round(√s) in 6–40, interior 0 below s 100 else round(s / 80)).
  - Its enclosed holes of at least `minHoleFraction` keep their rings, locked as edges, as the fine lattice kept them (eye sockets that face parallax holds over the eyes, ADR-022). The mesh engine gained `keepHoles` for a budget hull.
  - `density: "fine"`, or an explicit `spacing` or `edgeLength`, gives the old fine lattice. `density: "artist"` keeps ADR-024's behaviour (holes covered), as `meshing.all` does. Explicit `hullVertices` and `interiorVertices` still override.
  - Unchanged: `contour` meshes (16–23 vertices on the same ellipses, hull only), `surface`, `quad`, and the engine tool `autospine_feature_mesh`, whose callers choose their own options.
- **Key cleanup**: after the rest pose and the key poses, every bone rotation, translation and scale timeline is re-keyed with as few whole-frame keys as play within `motion.keyTolerance` of it (default 0.25 degree or px; scale in hundredths, so 0.25 %).
  - From frame 0, each key reaches as far as one segment can stay within the tolerance on every frame, on the best named ease (linear, sine, ease, out, in, drift); a segment still past it gets a fitted key curve. The first and last frames are always keyed, so a loop still closes.
  - A timeline with a stepped key (a swap, a mirror flip) keeps its keys, and so does one the cleanup would not shorten. Deform, colour and attachment timelines are not touched.
  - `keyTolerance: 0` keeps every compiled key.
- The skill and the plan runbook say: mesh deforming parts at the default too, and give counts (`hullVertices`, `interiorVertices`) only where a part needs more; `density: "fine"` only when the deformation checks (B1, B3) fail with fewer.

## Evidence

- `tests/artist-density.test.ts`:
  - A 420 × 360 ellipse with an eye socket: the budget mesh keeps the socket as a locked 14-point ring with the budget's 20-point hull and 5 interior points, 39 vertices against the fine lattice's 113; `density: "artist"` covers the socket.
  - The fixture's head (a planned `feature` mesh with dome weights, 80 × 80 px): 9 vertices at the budget, 100 with `density: "fine"`. The fixture's meshes total 92 vertices instead of 183.
  - A rotation keyed on every frame of a two-second swing: 61 keys become 15, playing within 0.3 degree of it on every third of a frame. A stepped timeline is untouched; tolerance 0 changes nothing.
  - Key poses on every second frame of the fixture idle (a smooth spine sway): the spine's 41 keys become 8, and all bone timelines go from 142 keys to 104. The fixture's procedural motion alone was already sparse: 101 keys become 96.
- The optimizer (ADR-017) measured the build's stretch against frame 0 and the artist's against the setup pose; a build compared with itself failed its own limit once the head had fewer vertices. It now measures the artist the same way (the limit is never tighter than before). The key-pose layering test measures the sum to a thousandth of a degree and sets `keyTolerance: 0`.
- **Not yet measured**: the Pig rebuilt with these defaults, against its artist file (B1 inversions and B3 stretch with fewer vertices, and the key counts). The files are on the requester's computer.

## Consequences

- A rebuilt character has roughly the artist's vertex count per mesh and sparse keys an artist can edit.
- Fewer vertices bend less smoothly. A part that folds (an elbow inside one mesh, a belly that squashes) may need explicit counts; B1 and B3 say where.
- The cleanup moves the motion by at most the tolerance between frames that were keyed before; numbers compared at 0.1 degree should set `keyTolerance: 0`.
- Rollback: `density` back to `"artist"` only, drop `keepHoles`, `simplifyAnimation` and `keyTolerance`.
- Amended by ADR-039 (2026-10-18): the budget hull bridged detached pieces the fine lattice had dropped, so slivers of neighbouring images left in a picture were meshed and drawn; it now drops pieces up to 2 % first.
- Superseded in part by ADR-041 (2026-10-20): the default counts come from the outline and the weighting bones instead of the image size, and the interior from rows at the joints instead of a lattice. The hole rings and the key cleanup stand.
