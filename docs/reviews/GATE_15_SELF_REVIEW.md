# Gate 15 — assistant engineering acceptance

Decision: **APPROVED_CONTRACT_AND_NUMERIC_CRITIC**, 2026-10-05. Final `GATE_15_SELF_CHECKS_2026-10-05_05.json`: 33 critic/planner/toolchain tests, format/lint/types passed.

Strict CorrectionSpec permits only reducing wave amplitude or regenerating weights/wave. No direct vertices, bone or weight replacement; unresolved seams require review. Corrections match asset, manifest and SHA256 of original asset/spec parameters, so reusing the same manifest ID after parameter changes still rejects before Core. Host job validation, low-confidence rejection and immutable rebuilding are enforced. Rebuilt metrics decide engineering success; no automatic art approval.

Known six-class numeric defect dataset plus clean control gives precision=1 and recall=1 **on these injected numerical cases only**. The actual bounded stress fixture uses 12 bones, 45° wave, phase 0: 23 inversion samples, area -0.1987543784. Corrected 8° wave: inversions 0, area 0.7831463553, stretch 1.1456640346, loop delta 0. Mesh and rig are regenerated identically, original output unchanged. An initial five-bone stress case actually passed and was not mislabelled as defective; the test was changed to an explicit fault-producing stress case, not a representative art benchmark.

This is a numeric critic and safe host-vision proposal port. No live visual model, screenshot classification eval, Jev or private image transmission occurred; live visual critic accuracy remains unverified. Earlier failed lint/type/test attempts remain recorded, with final evidence superseding them.
