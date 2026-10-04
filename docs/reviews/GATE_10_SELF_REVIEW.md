# Gate 10 — assistant engineering acceptance

Decision: **APPROVED_ENGINEERING**, 2026-10-05. Final evidence: `GATE_10_SELF_CHECKS_2026-10-05_03.json` (22 curve/preset/loop tests, format/lint/types passed).

Loop validator compares full-duration first/last translation, rotation, scale and deform offsets per target. Rotation differences wrap at 360°. Score is maximum channel delta divided by explicit positive tolerance (default 1e-6; units are recorded with channel); failures carry target, animation stage, measured delta and limit. Non-loop animations return `not-applicable`, never a fake pass. Fault injection covers each channel; 100 repeated scores match. Sampling is deterministic piecewise linear baked-key interpolation, with malformed keys and sample times rejected.

Large deform comparisons use reduction rather than a spread into function arguments. A syntax error introduced during that hardening is preserved in the second failed report and corrected before final checks. This stage proves positional closure, not continuous derivative/velocity closure or artistic timing.
