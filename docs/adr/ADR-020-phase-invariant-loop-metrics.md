# ADR-020 — phase-invariant performance metrics for looping animations

Context: a seamless loop has no visible start, but several ADR-017 acceptance measures depended on where the artist and the build happen to start:

- **`peakTime:<probe>`** is the global height maximum after 0.1 s. In a loop of several near-identical cycles, it picks whichever cycle is fractionally higher. On BaShouEnn_03, head 3.0 s against body 1.0 s gave a peak delay of 2 s for a head that leads the body by 3 frames.
- **`overshoot:<probe>`** is the peak height minus the last frame. In a loop the last frame is the first, so the value only says how far frame 0 sits from the top.
- **`peakDelay:<probe>`** inherits both problems.
- **Beat F1** in the blind-test protocols compares absolute frames.

On the YoLu_03 blind test (2026-10-14) the artist starts mid-breath and reaches the setup extreme on frame 13. The build breathed with the right period, shape and direction, yet every peak time and overshoot, and the planned beats (F1 0 at 3 and 6 frames), failed on phase alone. These eight of the sixteen D1 targets then decide the critic count without measuring motion. ADR-019 recorded the problem and deferred the fix to this decision, made before the next blind test.

Decision:

- **Loop mode in `measurePerformance`** (`options.loop`, and `PerformanceProfile.loop` for `reviewPerformance`):
  - If every probe's last sample repeats its first within 10⁻⁶ unit, that closing sample is dropped. Metrics are then measured around the circle.
  - `range:<probe>`: the probe's height range in head widths. It replaces `peakTime:<probe>` and `overshoot:<probe>`. Band ×/÷ 1.5, like other magnitudes.
  - `lag:<probe>` replaces `peakDelay:<probe>`.
    - It is the circular cross-correlation lag of the probe's height behind the chain root, in seconds, positive meaning later.
    - The search is limited to ±half the root's period, so it never jumps a cycle. Ties go to the smaller shift, and a still track gives 0.
    - The period is the first autocorrelation peak ≥ 0.5 within half the loop, otherwise the whole loop.
    - Band ±2 frames, like peak delay. The hint is the same follow-lag advice.
  - `handVsBodyRange` uses every frame instead of skipping the first tenth.
  - Parallax, pupil, hold-fraction and key-density metrics are unchanged. They are already independent of where a closed loop starts.
  - The critic classifies `range` as amplitude and `lag` as timing.
- **Where it applies.**
  - Character plans only produce loops, so `compare-reference` and `optimize-motion` (CLI and MCP) prepare the artist reference with `loop: true`.
  - `prepareReference`'s option defaults to `false`, so library callers comparing one-shots, and the built-in `entrance` profile, keep peak time, overshoot and peak delay.
- **Thresholds are unchanged.** D1 stays at ≥ 60 % of the targets. A three-probe chain with a hand now has 13 targets instead of 16. D1 counts from before this ADR were measured in one-shot mode and are not comparable with loop-mode counts. This includes ADR-017's Yuuna F4 21/22 and the BaShouEnn and YoLu results; none are re-judged.
- **Beat timing in future loop protocols.**
  - Report beat F1 after the best circular shift, applied the same way to the plan and to the uniform and random baselines. Raw F1 is reported alongside.
  - In a regular idle this measures only the count and spacing of the beats, and a correct count ties with uniform.
- **Not changed.** The optimizer's trajectory term still compares frame by frame. It deliberately reproduces one artist file, phase included, and is not an acceptance criterion.

Evidence:

- **`tests/performance-loop.test.ts`** (4 tests), on synthetic closed loops of 4 breaths in 240 frames:
  - The period is 60. Lags of 3 and 10 frames are recovered, never 10 ± 60. Still tracks give period n and lag 0.
  - Loop mode emits no peak, overshoot or peak-delay keys.
  - Every metric is equal (5 decimals) after circular shifts of 7, 13, 33, 101 and 239 frames, while the one-shot peak time moves with the shift.
  - A loop profile reviews a copy of its own sample started 41 frames later with all 12 targets within. Delaying only the hair by 4 frames fails only `lag:hair`, with the follow-lag hint.
- **`tests/character-reference.test.ts`**: a reference prepared with `loop: true` profiles `range:*` and `lag:*` with no phase keys. A build compared with itself passes every automatable criterion.
- **Re-measured after the fact** (evidence of behaviour only; the frozen verdicts stand):

  | Build                            | D1 before (one-shot) | D1 loop mode |
  | -------------------------------- | -------------------- | ------------ |
  | BaShouEnn_03 blind               | 1/16                 | 4/13         |
  | BaShouEnn_03 in sample, ADR-018  | 2/16                 | 5/13         |
  | BaShouEnn_03 in sample, ADR-019  | 9/16                 | 10/13        |
  | YoLu_03 blind (ADR-019 defaults) | 2/16                 | 5/13         |
  | YoLu_03 control (pre-ADR-019)    | 5/16                 | 6/13         |
  - On YoLu, `lag:head` is within for both builds; `lag:hair` is within for the blind build and low for the control.
  - What remains are real differences:
    - Body and head range is a third of the artist's (0.11 against 0.31 hw).
    - The pupil choice and vertical face parallax.
  - Beat F1 after the best circular shift: the blind breath plan scores 1.0 at shift 11, equal to 8 uniform beats. The settle control scores 0.667, equal to 16 uniform beats. The raw F1 is 0 for both.

Consequences:

- Loop acceptance now measures motion, not the start frame.
- Reports and plans using `peakTime:*`, `overshoot:*` or `peakDelay:*` for loops must read `range:*` and `lag:*` instead. Optimizer state saved under the old metric names should be restarted.
- The next blind test, on an unseen character, is the first to be judged with these metrics.
- Rollback: drop the `loop` option; profiles then fall back to the one-shot metrics.
