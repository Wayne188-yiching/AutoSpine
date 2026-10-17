<!-- Generated from docs/adr/ADR-037-mesh-deform-keys.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# ADR-037 — mesh deform keys from control points

Status: Accepted
Date: 2026-10-17

Context: the red-robed reindeer's Hit follows a reference (`紅袍麋鹿_受擊反應.mp4`) where the king clenches his teeth. The art has one mouth, a grin. A plan could swap attachments (ADR-027) but had no way to change a shape the art has no image for. The Spine compiler could already write deform timelines (`deformTimelines`: per key, a setup-world offset per vertex), but nothing in the plan reached it, and the mouth parts were artist-density meshes of 8–15 vertices, all on the outline.

The requester's decision (2026-10-17): key mesh deforms in the plan, the shape given by control points, and let chosen parts carry more vertices.

Decision:

- **Plan**: `motion.deforms[]: { id, parts, points, keys: { anim: [{ frame, move, ease? }] } }`.
  - `points` are named control points in the setup pose, IR world like every plan coordinate (x right, y down). A key's `move` gives `[dx, dy]` for some points; the others stay where they are, so unmoved points pin what should not change.
  - One block deforms several parts with one set of points (lips, mouth cavity and teeth together).
  - Frame 0 is the setup shape unless keyed; a loop closes on frame 0 and a one-shot (ADR-030) holds its last key. A key's ease shapes the segment arriving at it, as in `colors`.
- **Shape**: every vertex follows the points by moving least squares, affine (Schaefer, McPhail & Warren 2006), weights 1 / distance². An affine map of the points is reproduced exactly; fewer than three points, or points in a line, only translate (lint warns below three).
- **Build**: `compileCharacter` turns each block into one deform timeline per animation and part (offsets in setup world; the compiler writes them in each weighted bone's frame, so the deform turns with the head). A part that is not a mesh is refused (`PLAN_DEFORM_MESH`), and so is a part two blocks deform in one animation (`PLAN_MOTION_CONTROL`).
- **Density**: `meshing.parts: { part: { hullVertices?, interiorVertices? } }` meshes chosen region parts with their own counts (over the ADR-024 artist budget), rigid to their region bone, with or without `meshing.all`. A part also in `meshes` is refused.
- **Lint**: meshed parts, known animations and points, keys inside the animation and not two on one frame, one block per part and animation.
- **Merge** (ADR-031): blocks join by id when parts and points agree, else the later one is renamed; `meshing.parts` join and must agree.
- **Handover** lists each block's parts, frames and points; the keys are ordinary Deform keys in Spine.

Not decided here: fitting the points from a picture. The points and moves are written by hand (or by a script that measures the reference); compare-video then checks the result like any other motion.

Evidence:

- `tests/character-deforms.test.ts`: the affine reproduction and the translation fallback; the fixture's eyes meshed through `meshing.parts`, squashed to a third on frame 20 and back on 40, measured in the official runtime against the same build without the block (frame 0 and 40 identical, frame 20 by 5 × 2/3 px); lint and build refusals.
- The reindeer Hit (`C:/Wayne/Spine/紅袍麋鹿/Spine/AutoSpine`): the grin closed to clenched teeth on the frames the reference shows it.
