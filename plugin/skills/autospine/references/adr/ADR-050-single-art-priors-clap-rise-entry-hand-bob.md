<!-- Generated from docs/adr/ADR-050-single-art-priors-clap-rise-entry-hand-bob.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# ADR-050 — single-art priors: clap, rise-and-squash entry, idle hand bob

Status: Accepted
Date: 2026-10-19

## Context

The Jackpot mummy cat rebuild (plans 18–21, local) matched the artist's `clap`, `idle` and `idle2` only after the hand paths, the body lean and the torso squash were set from the artist file itself. That is benchmark tuning: it says nothing about a new character, whose job comes with images and a brief but no artist Spine file.

The ADR-032 priors had nothing for two of the motions:

- No clap or other two-hand action loop.
- One entry style only: scale in from about half, overshoot, fade (3 arts). The mummy cat enters without scale or fade: it rises from far below and the landing plays out in the body.

The idle priors already include the mummy cat (ADR-019 survey, ADR-022 face slide). The new measurements show a hand pattern that the survey's summary did not keep.

## Decision

Measure what the mummy cat's motion does in proportion units, keep it as three priors marked weak, and expose them only where a plan asks for them.

### Measurement

- The official spine-core 4.0 runtime at 30 fps, on the artist file.
- Units:
  - `hw`: the face probe's width on the images-only setup (`tou_1_2`, 703 px).
  - Reach: the shoulder-to-wrist length of the rebuilt arms (0.30 and 0.25 hw).
- Hands are measured at the rebuilt rig's wrist pivots, expressed in the artist's hand bones, so both files mean the same point.
- Only numbers are kept: no keys, curves or tracks. The script is local, under the character's `_work/notes/measure-priors.mjs`; its output is in `_work/checks/mummycat-priors.json`.

### Priors (`MOTION_PRIORS`, one animation each, one art)

- **`clap`**:
  - Rhythm: 15 frames per clap, four claps per body sway (the 60-frame loop), contact at 0.53 of each beat.
  - Body: leans 11.4° with the hands open and 17° [15–20.3] at contact, one way for two claps and the other for two; the head adds 8.5°; the body dips 0.047 hw at contact.
  - Open hands: about the full reach (1.08 [0.98–1.18]), 7.2° above the shoulder line.
  - Contact: wrists 0.21 hw apart, 0.03 hw below the shoulder line, between the shoulders (0.01 hw off). Palms turn 94° [78–110] toward each other.
- **`entryRise`**:
  - Path: the figure starts 1.33 hw below, is in place at 0.33 N, overshoots 0.019 hw and sinks 0.011 hw at 0.6 N. No scale, no fade.
  - Torso: leans 18° at the start, 5.6° the other way at 0.4 N.
  - Chest: stretches 0.023 hw at 0.37 N and squashes 0.087 hw at 0.67 N.
  - Head: 2 frames behind the chest, stretching 0.027 hw and squashing 0.147 hw.
  - Face: slides down 0.28 hw while rising, up 0.13 hw at 0.47 N, down 0.15 hw at 0.73 N.
  - Arms: wrists flung 0.59 reach above and about 1 reach out from the shoulders at 0.3 N, dropped 0.28 reach below them at 0.65 N.
- **`idleHands`**: free hands travel 2.9× the body (ADR-019 gave 1.3–2.5×), 2.6× relative to it, 5 frames behind (correlation 0.61–0.91). They bob twice per breath (0.054 hw) about as much as once (0.04 hw). Palms turn 33°.

### Engine

- `isWeakPrior(kind)`: a prior from fewer than `WEAK_PRIOR_ARTS` (2) independent arts is weak. This also covers the one-art walk, level-up and look priors.
- **`clapRecipe(hw)` and `clapPose(recipe, frame, arms)`**:
  - The recipe holds the clap in plan px.
  - The pose gives, for any frame:
    - the lean side and how closed the hands are;
    - the lean, the head lean and the dip;
    - the palm turn;
    - the wrist targets against the shoulders passed in (IR px, y down).
  - Open wrists stay within 0.98 of the arm.
- **`oneShotTemplate(name, { …, entry: "rise" })`** returns the rise-and-squash entry:
  - `move` translate only;
  - `body` keys for the torso tilt, the chest, the head and the face slide;
  - `arms` keys for each wrist against its shoulder in reaches, within 0.98.
  - The default stays `"pop"`: a name cannot tell the two styles apart, so the brief or the plan's author chooses.
- **`loopRecipe("idle", hw, { handBob: true })`** gives the free hands the `idleHands` values. Without it, `hand` is ADR-019's travel 1, 2 frames late, and no bob.
- Every template and recipe built on a weak prior carries `weak: true`.

## Consequences

- A new character can get a clap, a rise entry or bobbing idle hands from its own head width and arm length, with no artist file.
- **The numbers are from one art.** They are starting values to check against the brief and the video, not rules, until a second art agrees (ADR-032).
- **The mummy cat is in-sample.** Its rebuild cannot validate these priors. The check is a blind test on characters whose artist files are not opened before scoring, pre-registered like the 2026-10-15 motion-prior test.
- No plan schema changed. The recipes return numbers and keys an author writes into `keyed` tracks, `keyposes` and IK goals.

## Evidence

`tests/motion-priors.test.ts`, "weak single-art priors from the mummy cat (ADR-050)":

- Weak marking: the new priors and the earlier one-art ones are weak; the batch priors are not; the default entry is unchanged.
- Clap:
  - Four contacts per sway, wrists 0.209 hw apart and 0.028 hw below the shoulders, the dip at each contact.
  - Open wrists inside the arm; the lean counter-clockwise for two claps, then clockwise.
  - The loop closes, and a zero unit is refused (`PRIOR_UNIT`).
- Rise entry:
  - No scale, fade or figure rotation.
  - The path keys at 0/10/18/30 of 30 frames; the chest squash at 20 and the head 2 frames later.
  - The face slide's five keys.
  - Arms above the shoulders at 9 and below on the landing, all inside 0.98 reach.
  - Strictly increasing key frames from 2 to 60 frames.
- Idle hands: ADR-019 defaults without `handBob`, the weak values with it.
