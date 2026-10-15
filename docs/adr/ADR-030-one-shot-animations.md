# ADR-030 — one-shot animations

Context: phase 2 of the 2026-10 batch blind test covers one-shot animations: entries, exits, wins, transitions (`01_In`, `07 Out`, `Win`, `Collapse`, `into`, `out`). A character plan treated every animation as a loop:

- The keypose spec looped.
- Swaps closed on the frame-0 attachment, and keyed colours closed on their first value.
- Pulse periods had to divide the animation.
- The comparison failed an entry whose last frame differs from its first (A4 loop seam).

An entry that fades a logo in and keeps it would end transparent again.

While testing the change, a second problem appeared. The plan schema required an `ease` on every `keyed` key, which is tedious for an entry with many keys. A plan built without the schema check (as in a test) then failed with only "Valid RigSpec and KeyposeSpec required": the engine passed `{ value, ease: undefined }`, and the keypose object form requires an ease.

Decision:

- `motion.animations[].loop: false` marks a one-shot. The default is still a loop.
- In a one-shot:
  - The keypose spec does not loop.
  - The main motion gets a rest beat on the last frame, since there is no next cycle to return through.
  - Keyed tracks hold their last value; saccade looks need no room to close.
  - Swaps hold their last attachment, and keyed colours hold their last colour.
  - Pulse periods need not divide the frames.
- The comparison takes the plan's loop names. A one-shot gets no loop seam (A4) and no phase-invariant chain metrics; `engineering.oneShots` lists it.
- The handover notes mark a one-shot (單次動畫) and what it holds.
- A `keyed` key's `ease` is optional: without one it takes the beat's ease (a look arrives with `out`). A keypose input error names the first invalid path.

Evidence:

- `tests/character-oneshot.test.ts`:
  - An entry grows the spine from 0.2 to 1, fades the body in, and shows the eyes from frame 10. It ends on those values, and the main motion ends at rest.
  - The same plan as a loop closes them, and its 15-frame pulse is refused.
  - A self-comparison of the one-shot has no A4 row and passes.
- `tests/keyposes.test.ts`: an invalid `fps` is reported at `/fps`.

Consequences:

- Entries, exits and wins can be planned with `keyed` scale, translate and rotate keys, `colors` fades and `swaps`. One plan per one-shot, with `cycle` equal to its frames, keeps the main motion simple.
- Rollback: drop `loop` from the schema; animations loop again.
