# Gate 12 — assistant engineering acceptance

Decision: **APPROVED_ENGINEERING**, 2026-10-05. `GATE_12_SELF_CHECKS_2026-10-05_02.json`: 35 template/Tail/Arm/toolchain tests, format/lint/types passed.

Template has 18 named bones: root, pelvis, spine, chest, neck, head and mirrored upper-arm/forearm/hand plus thigh/shin/foot. Origin, height and shoulder width are explicit input. Ratios are a documented mechanical T-pose convention, not inferred anatomy. Tests verify parent-first, left/right world symmetry, schema, 100 identical runs, invalid dimensions, setup restoration, weights/preset/weighted Spine integration. No fingers, face or clothing added; Tail and Arm regressions passed.

Dependency review removed an undeclared direct TypeBox runtime import from rig; rig still depends only on neutral schemas. Generated construction is schema-verified in tests. No live model or art-quality acceptance, and no claim that a fish/strip fixture proves character-specific rigging.
