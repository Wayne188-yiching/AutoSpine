<!-- Generated from docs/adr/ADR-040-keypose-lag.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# ADR-040 — bones timed off the shared key frames (offset keys)

Status: Accepted
Date: 2026-10-18

## Context

Animators offset keys so that parts do not all land on the same frame: a head reaches its turn a few frames after the body, an arm after the shoulder, a hand after the forearm ("successive breaking of joints", Spine's Offset tool). AutoSpine's procedural motion already does this:

- `follow` lags a bone behind the main control (the idle head: 0.7 times further, 8 frames later).
- `waves` delay each bone of a chain (root 3 frames, tips 2 frames a bone in the idle recipe).
- The lags are measured on artist files (ADR-032, `beats.ts`): the Pig a median of 1 frame per hierarchy level, the mummy cat 3.3.

The motion fitted from a video (ADR-036) did not keep them. `fit-video` reduces every fitted bone to key poses on **shared** key frames (ADR-033: a bone missing from a key has no offset there), at most twice the category's key density or four a cycle. A head 4 frames behind the body in the video reached its extreme on the body's key frame, or between two keys with its swing cut. Only chains got their lag back, by re-timing waves (ADR-036 decision 4). ADR-036 left "per-bone key times" for later.

## Decision

A bone's key poses may play a few frames off the shared key frames.

### Plan

`motion.animations[].keyposeLag: { bone: frames }` plays the bone's key pose layer that many frames later, earlier when negative:

- a loop wraps;
- a one-shot holds its first value before and its last after.

The shared frames and ADR-033's semantics stay. The key cleanup (ADR-038) then keys each timeline on its own, so in Spine the bone's keys sit where its motion turns. Lint: planned bones, whole frames under the animation's length; a warning for a bone without key poses. `fit-pose` refuses to add pictures to an animation with lags (`CLI_FIT_LAG`): its keys would land on the shared frames the lags move away from.

### fit-video

`lagKeys` in `@autospine/motion`, before the shared key frames are chosen:

1. **Lag behind the parent.** Each fitted bone's most moving channel is correlated, at shifts up to the bound below, with the channels **of the same kind** of the nearest fitted bone above it that moves that way: a rotation with a rotation, never with the hips' bob. The best shift counts when it correlates at 0.6 or more and better than in step. Lags add down the hierarchy: a hand 2 frames behind the forearm that is 3 behind the body plays 5 after the body (a loop's total wraps into half its length). A bone that moves its own way (a leg stepping twice a cycle) correlates with nothing, and a bone that does not move rides along with its parent: both stay in step with it. A first version compared the spine's turn with the hips' bob, found a spurious 10 frames there, and hid the arm's 5 under the bound.
2. **Keys for the moved tracks.** Every bone's track is moved earlier by its lag and the shared keys are found again. A loop always keys frame 0, so where the keys fit depends on the layer's timing as a whole. The lags are tried with every common offset up to the bound (all bones moved alike; what plays stays the video's motion), scored on the fast reduction, and the best is reduced exactly.
3. **Kept only when better.** The lags are kept when their keys are no more and fit the channels better on average, without any channel more than 5 % worse. Where the plain keys already play within the tolerance, they are kept only if they save keys. A one-shot counts what a move loses at its ends (a bone played late holds its frame-d value before frame d). Otherwise every bone keys on the shared frames as before.

The bound is a third of a second, a quarter of a loop's cycle or an eighth of a one-shot, whichever is least.

Lags found only to place the keys better were tried and dropped. Moving each bone to where it fit the plain keys best gave lower errors on some clips, but the lags it found were not in the video: on the delayed-arm clip below it put the spine 8 frames before the hips and a forearm 3 before its arm. A requester reading the handover would take those for the video's timing.

### Report

- `summary.json` rounds: `keys.lag` (frames per bone, bones on the keys left out).
- The round's plan: `keyposeLag`.
- `--no-lag` / `lag: false` keys every bone on the shared frames.
- The handover notes say it as an animator would: "`arm_r` 比 `spine` 晚 5 幀": each bone against the nearest bone above it with key poses.

## Evidence

- `tests/keypose-lag.test.ts`:
  - **Head behind the body** (a 40-frame sway, the head 4 frames later): under caps of 3, 4 and 5 keys, the plain reduction stays within 2.88, 1.62 and 1.67 tolerances. With lags the head plays 4 frames after the body, and 2 keys hold every channel within 0.05: the common offset starts the layer on the sway's peak.
  - **A chain** (an arm 3 frames behind the body, a hand 2 behind the arm, a leg stepping twice a cycle): the lags are 3 and 2 down the chain and 0 for the leg, under caps of 4, 6 and 8 keys. The worst channel goes from 8, 2.48 and 1.52 tolerances to 2.68, 1.41 and 1.41.
  - **In step**: a bone counter-swinging in step with its parent, and one that does not move, get no lag; the reduction is the plain one.
  - **One-shot** (a rise over frames 10–20, the arm 3 frames later): the arm gets 3 frames. Under a cap of 4 keys the worst channel goes from 5.07 tolerances to 0.08; the lag is kept only where it still fits better after what it loses at the ends.
  - The key pose layer plays a bone its lag later: 6 frames on the arm; −75 on an 80-frame loop is 5 later; a one-shot reaches its last pose 6 frames later and holds it. Lint and the handover line.
- `tests/character-fit-video.test.ts`:
  - **Arm behind the spine** (`every: 2`, one round): the video's spine sways out and back over frames 0–30 and the arm swings the other way 5 frames later, both at rest from frame 35.
    - Keyed on the shared frames alone (`lag: false`): the four keys sit between the two timings. The worst channel is 4.17 tolerances; V1 0.95 / 0.876, V2 0.43 % / 2.69 %, V3 lag 1 and size 0.77: failed. The arm swings out on frame 16 instead of 14, within 1.79 degrees at worst.
    - With lags: the arm and the forearm riding on it play 5 frames after the spine, every other bone in step (all moved 1 frame by the common offset). The worst channel is 1.05 tolerances on the same four keys; V1 0.986 / 0.973, V2 0.15 % / 0.75 %, V3 lag 0 and size 0.93: passed. The arm swings out on frame 14, within 0.91 degree at worst. The handover notes say "`arm_r` 比 `spine` 晚 5 幀".
    - A first version of this clip kept the arm off rest on frame 0. The fit then carried a constant 3.3 degree bias on the arm with or without lags, because frame 0 is the zero frame (ADR-033); in a run, the rest pose is fitted from frame 0 first.
  - **Clean idle** (no lag in the video): no bone gets a lag. The four capped keys, their error (1.98 tolerances) and the rows (V1 0.975 / 0.957) are as under ADR-039, and it still passes in round 1.
- **Not yet measured**: the Pig and the other requester videos. Hand-made idles lag 1–3 frames a level (ADR-032), so their heads and limbs are where this should show.

## Consequences

- Fitted motion keeps the video's offsets between a bone and its parent; on few shared keys the moved tracks also fit better, so the cap costs less.
- `keyposeLag` values are whole frames; sub-frame lags are not kept.
- A loop's common offset can make every posed bone carry the same lag in the plan. The handover line shows only the offsets between bones.
- A lag between bones that do not correlate with their parents (a bone moving its own way, a parent that barely moves) is not found; those bones stay on the shared keys as before.
- The common offset scores up to 2 × the bound + 1 offsets on the fast reduction before one exact one. On a 240-frame loop with 45 channels this is 0.26 s when the keys are not capped (the plain reduction 0.08 s) and 6.2 s under a tight cap (0.38 s); the dense fit of such a clip takes minutes.
- Rollback: `lag: false`; drop `keyposeLag` from the schema and `shiftTrack` from the key pose layer.
