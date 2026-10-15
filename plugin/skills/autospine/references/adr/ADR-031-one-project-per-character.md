<!-- Generated from docs/adr/ADR-031-one-project-per-character.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# ADR-031 — one project per character

Context: the 2026-10 batch blind tests built one plan, and so one Spine file, per animation. The ThreePigWC wolf ended as ten files: three loops and seven one-shots. Their bones and slots matched, but their meshes did not: each plan meshed the parts its animation shows. The one-shots also had an extra `move` bone, each with its own pivot.

An artist taking over expects one project per character with every animation in it. With ten files, there is no project to open and refine.

A plan could already hold several animations, but they shared one set of motion blocks: one main cycle, one set of follows, waves, cycles and pulses. An idle and a win cannot share a main motion.

Decision:

- `motion.animations[].motion` holds an animation's own blocks: `cycle`, `params` (merged over the plan's), `main`, `beats`, `sink`, `follow`, `waves`, `cycles` and `pulses`. Keyed tracks, swaps and colour keys were already keyed per animation.
- The build compiles each animation on its effective motion (`motionFor`).
  - Transparent setup slots shown by any animation are still judged over the whole plan.
  - A colour block owns its slots only in the animations it keys.
  - The lint checks each animation on its own motion.
- `merge-plans` (CLI) and `autospine_merge_plans` (MCP) merge plans of one character, all reading the same images-only layout, into one plan:
  - The rigs are united.
  - Joints, meshes, regions, face and constraints must agree where they overlap. A bone may differ only by an inserted parent (a one-shot's `move` over the root's children); the deeper parent is kept. The same holds for a part on that parent.
  - Translate keys are authored in world space, so an inserted parent without keys leaves the other animations unchanged.
  - Each animation keeps, as its own motion, every block that differs from the first plan's.
  - Clashing keyed or colour ids are renamed.
  - Everything else that clashes is listed (`PLAN_MERGE`) and nothing is written.
- One-shots of one character share one pivot: the base plan's `ground` joint, else the box of every placed image. Pivots computed from each one-shot's shown parts do not merge.
- Animation names may hold Spine folders (`History/_Look`). Build and comparison file names keep safe characters only.
- The Spine compiler takes one attachment, colour or deform timeline per animation and slot: up to 32768 (64 animations × 512 slots) instead of 512. Its input error names the first invalid path.
- The handover notes list a keyed bone without images (`move`) as a control bone (red).

Evidence:

- `tests/character-merge.test.ts`:
  - A loop plan and a one-shot plan with an inserted `move` bone merge. Each animation of the merged build matches its own build within 0.001 px at five times.
  - Conflicting joints and regions are listed. Two copies of one plan are refused, because animation names repeat.
  - The CLI merges two plan files and builds one project with both animations and their keypose files (`keypose-Extra_IN.json`).
- ThreePigWC wolf (private, local):
  - Ten plans merge into one plan, one build of 48 bones with 10 animations.
  - Each animation scores against the artist exactly as its own blind build did.
  - The official 4.0.64 editor CLI imports it into a `.spine` project and exports it back. Bones, slots and animations are kept, and drawn vertices differ by at most 0.10 px.

- All batch characters (private, local), one project each:
  - wolf (10 animations), BuddhaEX (13), eagle, jaguar, moose (3 each), the two walking wolves (6 each), trophies, soccer ball, logo, Award, the effects files.
  - Every round trip keeps bones, slots and animations; drawn vertices differ by at most 0.13 px.
  - BuddhaEX first failed to build: its 13 animations needed more than 512 attachment timelines.
- `tests/key-curves.test.ts`: 600 colour timelines (12 slots × 50 animations) compile; an invalid input names its path.

Consequences:

- The handover is one Spine project per character, with `HANDOVER.md` covering every animation.
- Blind tests can still plan one animation at a time; merging comes after.
- Rollback: drop `animations[].motion` and the merge tool; one plan per animation again.
