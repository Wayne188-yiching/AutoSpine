# ADR-022 — face parallax targets and face holds

Context: the face sink slid the face control by `y` px at full depth. How far the eyes then move against the face plate depends on the dome weights: the follower's mix against the plate's mean control weight, with the counter bone pulling the other way.

- **The conversion varies by character.** The same slide gave 0.33 of it in eye parallax on BaShouEnn_03, 0.44 on YoLu_03 and 0.6 on the gingerbread. The ADR-019 head-width rules (0.09, then 0.06 hw) therefore overshot on both unseen characters, at 1.8× and 2.7× the artist's vertical parallax.
- **What artists do** (style survey, 12 idles of 9 characters, all seen, panda excluded: its eye probe swaps images):
  - Vertical parallax is 0.012–0.058 hw, median 0.031.
  - Horizontal parallax is about a fifth of vertical.
  - Six idles slide the face continuously with the breath (hold fraction below 0.2). Three hold it most of the time and move it in one or two short moves (Yuuna_01 0.94, YoLu 0.83, gingerbread 0.90), and mummy cat idle2 sits between (0.43).
  - So a hold is a style, not a default.

Decision:

- **`sink` face `parallax`** (head widths), an alternative to `y`; exactly one is required (`PLAN_MOTION_FACE`, lint).
  - It is the vertical travel of the first face follower against the face plate at full depth, which is what the critic measures with the eyes and face probes.
  - `rigCharacter` derives `faceParallax`:
    - `perPx` = the first follower's mix − the mean, over the plate's vertices, of (control weight + counterMix × counter weight).
    - `unit` = the width of the face image's rectangle, which is the critic's head width.
  - The slide is then parallax × unit / perPx px. `x` stays a ratio of the slide.
  - Parallax needs a dome-weighted plate whose first follower moves against it.
- **`sink` face `move`** (frames), for characters whose face mostly holds:
  - The face control holds between main beats and arrives at each beat's value `move` frames after the beat, with an `out` ease.
  - Frame 0 holds the last beat's value so the loop closes. A move that would run past the next beat fails (`PLAN_MOTION_TIMING`).
- **Defaults** (skill and `docs/CHARACTER_PLAN.md`):
  - `parallax: 0.03`, the survey median, with `x` 0.2.
  - Continuous slide, which is the majority. Use `move` (about 4–6 frames) only when a brief or reference shows the face holding.

Evidence:

- **`tests/character-parallax.test.ts`** (3 tests), on the official runtime:
  - Targets 0.015 and 0.03 move the eyes against the face plate by the target to within 0.001 hw, with no horizontal drift for `x` 0.
  - With `move` 4, keys sit at 0/4/20/24/40/44/60/64/80, with held pairs, and the eyes are still outside the move windows.
  - Both `y` and `parallax`, a move past the next beat, and parallax without a dome face are rejected.
- **In sample** (all three artists already seen; `plan-px-*` and `compare-px-*` in each review folder):

  | Character                    | Artist's vertical parallax as the target | Default 0.03  |
  | ---------------------------- | ---------------------------------------- | ------------- |
  | BaShouEnn_03 (artist 0.0304) | 0.0266 within                            | 0.0262 within |
  | YoLu_03 (artist 0.0223)      | 0.0227 within (+2 %)                     | 0.0305 within |
  | Gingerbread (artist 0.0125)  | 0.0177 within                            | 0.0353 high   |
  - The conversion is exact when the face slide is the only source. Head rotation from the head follow adds the rest, because it turns the eyes-to-plate vector, and it also raises horizontal parallax on BaShouEnn.
  - D1 with the default: YoLu 6/13 (from 5/13 with the ADR-019 slide), BaShouEnn 10/13, gingerbread 3/10.

Consequences:

- Face motion is planned in the units the critic and the artists' statistics use, independent of the dome's shape.
- The default lands within the artist band on two of three characters. The miss is a character whose artist holds the face, which images do not reveal.
- This has not yet been tested blind: the next unseen character is the first test of it.
- Rollback: drop `parallax` and `move`; `y` becomes required again.
