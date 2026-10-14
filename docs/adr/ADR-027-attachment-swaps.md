# ADR-027 — attachment swaps inside an animation

Context: the ThreePigWC eagle, jaguar and moose idles (2026-10 batch blind test) show eyelid slots that are hidden in setup and appear during the idle: blinks. ADR-021's part sets hold one attachment for a whole animation, so a plan could only keep the eyes closed throughout or never blink. Blinks, mouth shapes and flash frames are common enough to need a plan block.

Decision:

- `motion.swaps[]: { slot, keys: { animation: [{ frame, attachment | null }] } }`:
  - Each key switches the slot to an attachment, or hides it with `null`.
  - Before the first key the slot keeps its part-set or setup attachment; the last value holds to the end.
  - A swapped slot replaces that animation's `show` / `hide` hold for the slot.
- Lint reports an unknown slot or animation and keys past the end. The build reports an attachment the slot does not have (`PLAN_SWAP`).
- The handover notes list the swap frames per animation.

Evidence: `tests/character-swaps.test.ts`. A blink hides the fixture's eyes from frame 30 to 34 on the official runtime, and is shown before and after. A key past the end and an unknown attachment are refused.

Consequences:

- Blinks and mouth shapes are plain attachment keys in the Spine file, the way animators make them.
- When to blink is still the plan's choice; the images do not tell.
- Rollback: drop `swaps`; the part sets are unchanged.
