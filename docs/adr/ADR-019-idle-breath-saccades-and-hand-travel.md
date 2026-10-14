# ADR-019 — idle breath, saccade looks and hand travel in character plans

Context: after ADR-018, the BaShouEnn_03 in-sample rebuild still met only 2 of 16 performance-critic targets (D1). The misses were style: when the body peaks, eye saccades and hand range. To avoid fitting one file, ten artist idles from seven characters already seen in earlier blind tests were measured on the official runtime at 30 fps: BaShouEnn, Yuuna_03, Yuuna_01, Yuna_Standard ×2, panda ×2, pig and mummy cat ×2. Lengths are in head widths (hw). The survey script is kept locally under `docs/local-reviews/style-survey-2026-10-14/`; artist files are not committed.

- **Body.** 9 of 10 idles rise and fall in equal frames (within 2): 30/30 for the four mahjong characters, 17.5/18 for pig and 16/16 for mummy cat. In every one, frame 0 is the setup pose and one end of the breath. Direction splits about evenly: Yuuna sinks from the setup pose, while BaShouEnn and mummy cat rise. The range is 0.10–0.24 hw for the mahjong characters (median 0.13). `CharacterPlan` only had the `settle` template (anticipation lift, sink, hold, rise), whose beats sit in the wrong place for an idle.
- **Head lag** behind the body: median 0 frames, range −2 to +7.
- **Eye parallax** against the face: vertical about 0.03 hw, horizontal about a fifth of that (median ratio 4.9).
- **Pupils.** 4 of 10 idles saccade: 1–4 looks per 4 s, each move 3–7 frames, held 66–94 % of frames. The other 6 drift only with the face.
- **Hands.** A hand holding or resting on a prop barely moves in the world: BaShouEnn moves 0.34× the body, Yuuna_01 0.61×, and both are uncorrelated with it. A free hand moves in phase (correlation 0.7–1.0) at 1.3–2.5× the body. Relative to the body, it travels about 1× the body's travel.

Decision:

- **`motion.main.shape`**: `"settle"` (the default, unchanged) or `"breath"`.
  - A breath keys rest at the cycle start and `depth` at `down` (usually half the cycle), with sine both ways.
  - `cycleScale` scales a breath's depth. Extra `beats[]` key only `rest` and `down`; `scaleUp` scales `down`.
  - The face sink slides with the body in either direction: `face.y × y / |depth|`.
  - `up`, `hold` and `rise` become optional; a settle cycle still requires them (lint and build `PLAN_MOTION_TIMING`). Lint warns when a breath carries fields it ignores.
- **`motion.keyed[].move`**: with `move`, each key is a saccade.
  - The control holds its previous value until `frame`, then arrives at `value` `move` frames later with the key's ease.
  - If the loop ends away from `rest`, a closing move ends on the loop, and the frame-0 key gives it an `out` ease.
  - A look that starts before the previous one arrives, or that leaves no room to close, fails with `PLAN_MOTION_TIMING` (lint reports it too).
- **`motion.follow[].travel` with `to`**: an alternative to `gain` on a rotate control.
  - The `to` bone moves `travel` × the main's vertical travel relative to `bone`: gain = travel × 180/π / |to − bone| degrees per px.
  - The sign is chosen so a positive travel moves `to` with the main when `to` sits beside the pivot.
  - Exactly one of `gain` and `travel` is required (`PLAN_MOTION_FOLLOW`).
- **Planted hands** need no new block: an IK constraint whose target bone hangs on `root`.
- **Defaults** (skill and `docs/CHARACTER_PLAN.md`), from the survey. These are the values before the YoLu blind test; see the update below:
  - Idle: a breath with `down` at half the cycle; sink when the direction is unknown.
  - Head lag 0–2 frames.
  - Face slide `y` about 0.09 hw (eye parallax is about a third of the face slide), `x` about 0.2.
  - Optional looks: 4–5 frames with `out`.
  - Hands: pin a hand on a prop with IK; give a free hand `travel` ≈ 1 with lag 0–3.

Evidence:

- **`tests/character-style.test.ts`** (9 tests), on the official runtime and the compiled JSON:
  - A breath keys frames 0/20/40/60/80, with the second cycle scaled 0.8. The way down mirrors the way back within 1e-4, and the face slides with the body in both directions.
  - Lint and build reject a settle cycle without its beats.
  - Looks hold and move in `move` frames, and close the loop only when needed. Overlapping and late looks are rejected.
  - With travel 0.8, the elbow's chord relative to the shoulder is 0.8 × the body's 5 px. A positive travel moves a shoulder beside the spine down with the sink, and a negative one moves it up.
- **BaShouEnn_03, in sample.** These results were already seen, so this is not validation.
  - The changes: breath (rising, 10 px), face slide 4 px, a pupil bone with one look, the glass hand pinned by IK, and no arm follow.
  - The critic went from 2/16 to 9/16. All three pupil metrics, hand range, parallax hold, and body and head amplitude now fall in the band; C2 and C3 stay at 1.0 and B1 at 0.
  - Vertical parallax is still half the artist's. Peak times and delays mostly measure which of two identical breaths holds the global maximum: head 3.0 s against 1.0 s, for example.

Update after the YoLu_03 blind test (2026-10-14, `docs/local-reviews/yolu-e2e-blindtest-2026-10-14/`, frozen before any artist timeline was read):

- **Primary (ADR-017).** Not passed, 9/11 automated criteria. C2 0.957, C3 1.0, D2 0.674, B1 0; A1 6.18 px is inherent to the artist setup; D1 2/16.
- **Pre-registered ADR-019 check.** Not met. The blind plan scored D1 2/16 against the pre-ADR-019 control's 5/16 (2/11 against 4/11 without peak times and delays). D2 went from 0.105 (control) to 0.674.
- **What held.**
  - Four symmetric 2 s breaths: the artist turns every 29–31 frames.
  - The setup pose is one end of the breath, and the motion sinks from it.
  - Eye parallax is about five times taller than wide (4.9).
  - Hand travel lands in the band.
  - Light and sparkle pulses gave recall 0.957.
- **What failed.**
  - Adding saccades: the artist pupils only drift, and all three pupil metrics missed.
  - A face slide of 0.09 hw: vertical parallax came out 1.8× the artist's.
  - Continuous parallax: the artist holds the face 83 % of the time.
  - Travel 1 is on the large side.
- **Phase.** The artist starts mid-breath and reaches the setup extreme on frame 13. Planned and artist turns are therefore 12.5 frames apart (beat F1 0), and peak-time, peak-delay and overshoot metrics miss on phase alone. A loop's start is invisible, so these loop metrics should be made phase-invariant in a separate ADR, before the next blind test; this result is not re-scored.
- **Defaults changed** (YoLu is now seen):
  - No saccades unless asked.
  - Face slide about 0.06 hw.
  - Free-hand travel about 0.4 (survey median; range 0.2–2.2).
  - Hands resting on something are pinned by IK to that thing's bone (`root`, `head`).
  - The sink default stays (by character: Yuuna and YoLu sink, BaShouEnn and mummy cat rise).

Consequences:

- Idle plans can state the shape artists use, and looks and hand range are data. Existing plans are unchanged: settle stays the default, and `gain` still works.
- The defaults come from seen files only. An unseen character must test them before they count as validated (next: MaZhaoYuan_v01, end to end).
- Loop peak-time and peak-delay metrics are ambiguous when an animation repeats identical cycles. Until they are measured per cycle, report them separately.
- Rollback: remove `shape`, `move`, `travel` and `to`; `up`, `hold` and `rise` become required again.
