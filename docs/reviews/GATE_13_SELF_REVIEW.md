# Gate 13 — assistant engineering acceptance

Decision: **APPROVED_ENGINEERING**, 2026-10-05. `GATE_13_SELF_CHECKS_2026-10-05_02.json`: 10 constraint/template/Arm tests, format/lint/types passed.

Implemented neutral sequential baked-pose solvers: one/two-bone analytical IK with law-of-cosines, explicit bend sign and mix; local absolute transform copy of rotation/translation/scale/shear; world-space polyline arc-length placement and tangent alignment. Tests independently check reachable tips, folded and unreachable cases with residual diagnostics, zero-mix identity, negative bend, repeated determinism, actual transform/path motion and source immutability.

Supported v1 limits are explicit: IK unit-scale unsheared contiguous chains; transform local/absolute only; polyline (not Spine Bezier attachment modes). Affine IK, world/relative transform modes, missing paths, range overflow, feedback targets and competing bone drivers reject. Output is a new baked RigSpec pose; original setup is not modified. No Spine-specific serialization, AI, file I/O or external calls in this package. Broader Spine constraint mode parity is not claimed.

First run stopped at lint due to mutable declaration of a never-reassigned variable; corrected and rerun before acceptance. No numerical thresholds changed.
