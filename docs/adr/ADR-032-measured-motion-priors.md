# ADR-032 — measured motion priors

Context: the 2026-10 batch blind test built 68 NAS animations. Structure passed about 98 % of its checks, but motion style failed: D1 passed 5 of 68, D2 18 of 68. Two causes stood out:

- The defaults were too strong where artists are calm. Idle bodies moved 2–8 times too much.
- They were too weak where artists act. Jumps and charges moved 0.3–0.6 times as much as the artist's, and the one-shot templates guessed their shape from the name.

The defaults came from earlier, smaller surveys (ADR-019: 12 idles of 9 characters, measured on chests and torsos) and from guesses (the 2026-10 one-shot templates).

Decision: replace those defaults with priors measured on every artist animation the batch compared, and keep them as priors with their ranges, not a fit to any one file.

## Measurement

- Every compared animation: the artist file, and our frozen build of the same animation, measured the same way on the official spine-core 4.0 runtime at 30 fps.
- 68 animations in 19 files: 15 independent arts. Reskins (three trophies) and the second wolf folder were averaged per art and animation name before taking medians.
- Each animation was put in a category by its name and file kind before any number was read: idle, action loop, walk, prop/logo loop, entry, exit, jump/win, charge/press, transition, and effect one-shot.
- Units:
  - `hw`: head widths, the width of the plan's face probe on the images-only setup. This is the critic's unit.
  - `N`: a fraction of the animation's frames.
  - Rotations are peak to peak, a best-fit rotation of each part's vertices against the body, taken as the median over the parts of a role.
  - Roles come from the bone that carries each part in our build: limb, strand (ear, tail, hair, tuft), face, prop, effect.
- What was measured:
  - Body probe range and cycles per loop.
  - Head and strand-tip lag, by cross-correlation.
  - The whole figure as a similarity transform over its parts: scale, tilt, offset and alpha against frame 0 and the last frame.
  - The jump hop: dip, top and landing.
  - The ease shape of every keyed segment (in-out, out, in, linear, stepped) and the key spacing.
- The script reproduces the critic exactly where both measure the same thing: the artist's `range:body`, `lag:head` and `lag:tail` match `acceptance-results.json`.

## Priors

Median, range in brackets, then ours as built (artist = 1 means ours equals the artist).

| Category (animations / arts)      | Measure                 | Artist                                                                 | Ours                         |
| --------------------------------- | ----------------------- | ---------------------------------------------------------------------- | ---------------------------- |
| Character idle (8 / 7)            | hips range              | 0.061 hw [0.017–0.141]                                                 | 0.14 (2.3×)                  |
|                                   | head range / hips range | 1.64 [0.69–3.16]                                                       | 1.07                         |
|                                   | head lag                | 3 frames [−1–10]                                                       | 0                            |
|                                   | cycle                   | 2.33 s [0.97–3.0]                                                      | 2.33 s                       |
|                                   | strands                 | 16° [8–23], tip 4 frames behind [0–26]                                 | 6°, 0                        |
|                                   | limbs                   | 3.5° [1.5–27]; most-moving limb 10° [3–51]                             | 3°, 3°                       |
|                                   | eye parallax, vertical  | 0.021 hw [0.010–0.082]                                                 | 0.034                        |
|                                   | eases                   | in-out 39 %, out 29 %, in 29 %; key every 20 frames                    | in-out 70 %; 34 frames       |
| Action loop (4 / 3)               | hips range              | 0.087 hw [0.016–0.30]                                                  | 0.14                         |
| Walk (6 / 1)                      | bob                     | 0.34 hw [0.29–0.38], 0.12 of the height, twice per stride              | 0.049 (0.15×)                |
|                                   | limbs / strands         | 89° / 36°                                                              | 42° / 7.5°                   |
|                                   | eases                   | 43 % linear                                                            | 0 %                          |
| Prop / logo loop (6 / 4)          | base                    | 0 hw [0–0.01]; the motion is alpha (35 % of parts) and image sequences | breath 2–3 px                |
| Character entry (3 / 3)           | start                   | 0.62 hw below the end, scale 0.48, alpha 0.51                          | 1.1 below, 0.3, 0            |
|                                   | overshoot               | 0.27 hw above the end, scale 1.27 at 0.52 N                            | 0.05, 1.06 at 0.35 N         |
|                                   | alpha full              | 0.34 N                                                                 | 0.22 N                       |
| Logo / prop entry (2 / 2)         |                         | fade in by 0.2–0.4 N, no scale                                         | scale 0.3 → 1                |
| Character exit (2 / 2)            | start                   | 0.055 N; no hold                                                       | 0.28 N                       |
|                                   | path                    | lift 0.15 hw, then drop 0.7 hw and shrink to 0.51; alpha kept (0.79)   | fade to 0                    |
| Jump / win (5 / 4)                | hop                     | dip 0.16 hw at 0.13 N, top 0.36 hw at 0.25 N, landed at 0.32 N         | 0.08, 0.23 at 0.35 N, 0.62 N |
|                                   | side travel             | 0.22 hw                                                                | 0.02                         |
|                                   | limbs / strands         | 54° / 52°                                                              | 3° / 6°                      |
|                                   | keys                    | every 6 frames                                                         | every 27                     |
| Charge (3 / 3)                    | figure                  | tilt 13° peak to peak, side 0.18 hw, no lift, scale ≤ 1.04             | 2°, 0.03, scale 1.06         |
|                                   | limbs / strands         | 22° / 53°                                                              | 3° / 8°                      |
| Transition (17 / 4)               | figure                  | tilt 7°, side 0.11 hw, lift 0.03 hw at 0.6 N                           | 2°, 0.04, 0                  |
|                                   | limbs                   | 31°                                                                    | 13°                          |
| Every character one-shot (31 / 7) | limbs / strands         | 41° / 35°                                                              | 5.5° / 6.7°                  |
|                                   | figure                  | tilt 15°, side 0.19 hw                                                 | 0.8°, 0.02                   |
|                                   | keys                    | every 8 frames, in-out 61 %, 31 % of parts change alpha                | every 14, 3 %                |

Findings that hold across categories:

- Character idles keep the hips nearly still and let the head travel 1.6 times as far, about 3 frames later. The old 0.14 hw was measured on chests and torsos, and the ADR-025 skeleton puts the main breath on the hips.
- Prop and logo loops keep the base still. Alpha, sequences and effect parts carry the motion.
- In character one-shots, limbs and strands swing 5–10 times more than our templates did, and the whole figure tilts and shifts sideways. Artists key every 6–9 frames, mostly with in-out curves.
- Exits start at once and characters do not fade. Entries start half transparent and half size, rising from below with an overshoot.
- The jump is a quick hop, landed within the first third; the rest of the animation is the pose playing out in the limbs.
- Several categories rest on one or two arts:
  - walk, level-up and look: one art each;
  - exit and logo entry: two arts.
    These are weak priors, labelled with their counts. The effect one-shots on a character (one art) and the action loops (heterogeneous) give no template.

## Decision

- `@autospine/motion` exports the measured priors and the recipes that use them:
  - `MOTION_PRIORS`: median, minimum and maximum per category, with animation and art counts.
  - `oneShotKind(name)` chooses the template by the pre-registered keywords, whole words only.
  - `oneShotTemplate(name, { frames, unit, subject })` returns keys from the medians: translate, scale and rotate for a `move` bone, alpha for the shown parts, a head look, and the swing of limbs and strands with the key spacing. Props and logos keep their base still. They only fade in on entries, and fade while growing on exits.
  - `loopRecipe(kind, unit)` gives the loop recipe in plan terms:
    - idle: hips 0.06 hw; head translate follow 0.7 × the main, 8 frames later; strands ±8°, tips 2 frames per bone; limbs ±2°; 2 s cycles;
    - walk: bob 0.34 hw twice per stride;
    - prop: a still base.
- A `follow` on a translate control takes `gain` as a fraction of the main's offset, moving the bone that much further, `lag` frames later. The head of an idle uses it. Travel and a scale channel are refused.
- `LOOP_CYCLE_RANGE_SECONDS` widens to 1–3 s. The median stays 2 s.
- The skill and the plan runbook state the new defaults with their counts and ranges.
- A brief, a reference or a user request still overrides a prior.

## Evidence

- `tests/motion-priors.test.ts`:
  - Every median lies inside its range.
  - The names of the batch choose the pre-registered templates.
  - A jump dips, hops and lands at the measured fractions.
  - Characters rise in from below and keep their alpha on exits; props only fade.
  - Key frames stay strictly increasing down to 2-frame animations.
  - A jump template flows through a one-shot plan into the built Spine file.
  - A translate follow moves the head 0.7 × the hips, 8 frames later, and the lint refuses travel, a scale channel and a non-translate main.
- `tests/beat-planner.test.ts`: a 3 s breath is inside the range; 3.3 s warns.
- Recipe check, in-sample (local `recipe-check.mjs`): eagle, jaguar and wolf 02_Idle rebuilt with the idle recipe.
  - Measured: hips 0.06 hw, head 1.7–2.0 × the hips and 3 frames behind, strands 14–17°.
  - This checks that the recipe produces the prior. It is not a blind result: these files are part of the measurement.

## Consequences

- Plans start from measured values with known spread instead of guesses. Any category can still miss by a factor of ten on a given character; the range says how far.
- Re-scoring the batch with these priors is in-sample and proves nothing. The priors are pre-registered for a blind check on files AutoSpine has not seen (local protocol `docs/local-reviews/blind-tests/2026-10-15-motion-priors/PROTOCOL.md`).
- Rollback: drop the priors module, the translate follow and the wider cycle range; the earlier defaults are in ADR-019 and the 2026-10 protocol.
