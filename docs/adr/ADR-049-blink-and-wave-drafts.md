# ADR-049 — blinks and a wave in motion drafts

Status: Accepted
Date: 2026-10-23 (plugin 0.5.15)

## Context

ADR-048 drafts ten kinds of motion from the measured priors. Two common requests were missing:

- **Blinks**: most character idles blink, and USER_GUIDE already asks the requester whether to blink. Nothing in the engine wrote one; each plan keyed `swaps` (ADR-027) or a scale by hand.
- **A wave** ("Hello", 揮手): a one-shot on one arm, not on the whole figure, so none of the ADR-032 templates fits.

ADR-032 measured neither. The 2026-10 batch has no wave, and its blinks were not separated from the idles.

## Decision

`motion-draft` and `autospine_motion_draft` take two more kinds, `blink` and `wave`.

**Without `--kind`**, the name decides first: `blink` or 眨眼 gives blinks; `wave`, `hello`, `greet`, 揮手 or 打招呼 gives a wave. Then the ADR-048 rules apply.

**Timing (`BLINK`, `WAVE` in `@autospine/character`)** is conventional, not measured, and every draft's notes say so:

- a blink: the eyes shut for 4 frames at 30 fps (`closedSeconds` 4/30, at least 2 frames), about every 3 s. The first blink comes 0.4 of the way into its share of the animation;
- a wave: the arm rises over the first fifth, the forearm swings ±20° three times each way, the hand ±10° two frames behind it, and the arm lowers over the last fifth.

**Blinks go into an animation the plan has**, normally the idle (`--animation=IDLE --kind=blink`). The animation keeps its length, its own `motion` and its other keys. A `--frames` that differs is noted and not used. A blink named for an animation the plan lacks is refused. The draft tries three ways, in order:

1. **A closed-eye image**: a shown slot whose setup attachment has a sibling named like `closed`, `blink`, `shut`, 閉 or 眨. The blink swaps to it and back (`motion.swaps`).
2. **An eyelid slot hidden in setup**: a slot with no setup attachment whose attachment or name looks like a lid (`lid`, `blink`, `closed`, …). The blink shows it, then hides it again.
3. **A squash of the eyes probe's bone** (`qa.probes.eyes`) to 0.1 across the screen's vertical: scale Y for a bone lying across the screen, X for an upright one. Keys go in on frame 1 and out on the last shut frame, as a `keyed` scale control. This is refused when the bone carries more than the eyes:
   - a structural bone: the head, the main bone, the face base, control or counter, `root` or `move`;
   - or a bone that carries slots not named like eyes (`eye`, `pupil`, `iris`, `white`, `highlight`, 眼, 瞳), such as lashes or brows.

Slots the animation hides are left out. Running the draft again replaces the animation's own swaps or squash keys.

**A wave** keys the right upper arm (else the left, else an unsided arm), its first child (the forearm) and that bone's first child (the hand). It needs the rig's world bones from the caller (`DraftFigure.bones`).

- The arm rotates so it points up and out of the body: -45° on the side away from the pivot, -135° on the other (IR degrees, y down).
- The forearm turns upright from the raised arm, then swings.
- Every key starts and ends at rest; a wave adds no `move` bone.
- With no arm bone the wave is refused; with no forearm only the arm rises, and the notes say so.

## Evidence

- `tests/motion-draft.test.ts`, ADR-049 block:
  - **Closed-eye image**: the fixture idle (80 frames) blinks once, swapping `Eyes` to `Eyes_closed` at frame 32 and back at 36. A hidden lid slot is not keyed as well, and the idle's own animation entry is unchanged.
  - **Hidden lid**: shown at 32, hidden at 36. `frames: 40` is noted and not used. A second draft replaces the swaps.
  - **Squash**: through the CLI, the fixture idle squashes `eyes` (keys 32, 33, 35, 36), keeps the `look` control on the same bone, and builds.
  - **Refused**: lashes on the eyes bone; eyes riding `head`; no eyes probe; `Blink` absent from the plan.
  - **Wave**: `Hello` (60 frames) keys `arm_r` (0, 12, 48, 60) and `forearm_r` (nine keys, ±20°). The raised arm points at -45° or -135°, no `move` bone is added, and it builds. With no rig bones given, the wave is refused.
- **Bundled example** (`assets/example`), drafted, built and rendered: `Hello` raises the right arm up and out with the forearm waving; the `IDLE` blink squashes the eyes on frames 33–35.
- **Panda**: the idle blink squashes `1_eyes_ctl`. Its second eye image is not named like a closed eye, so the draft did not swap to it.
- **Pig** (plan-09):
  - The blink is refused: the eyes probe's bone also carries `1_lashes`.
  - The wave is refused: no arm bone.
