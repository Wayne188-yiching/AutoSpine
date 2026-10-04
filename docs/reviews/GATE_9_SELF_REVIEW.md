# Gate 9 — assistant engineering acceptance

Decision: **APPROVED_ENGINEERING**, 2026-10-05. `GATE_9_SELF_CHECKS_2026-10-05_03.json`: 19 curve/preset tests and format/lint/types passed.

Reviewed linear, stepped, smoothstep ease, cubic Bezier (bisection inversion of x, not treating time as the Bezier parameter), and bounded ease-out-back overshoot. Exact endpoints, 1001 monotonic samples for non-overshoot examples, linear/symmetric Bezier numerical oracles, deliberate overshoot, invalid inputs and independent import boundary are tested. Overshoot and arbitrary y-control Beziers need not be monotonic; this is intentional. The curve file imports only neutral error handling and contains no preset dependency.

Two failed test runs are retained: a boundary regular expression incorrectly matched a comment, then the word `autospine` in a legitimate rig dependency. Import matching was corrected; no engine behavior or threshold changed to obtain acceptance. No artist or external-model claims.
