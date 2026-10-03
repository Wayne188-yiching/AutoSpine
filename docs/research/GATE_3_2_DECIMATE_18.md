# Gate 3.2 — raster-constrained boundary decimation

Status: **IN_DEVELOPMENT / formal Jev NOT_SUBMITTED / not pushed**.

## Implementation and scope

Astra implemented the opt-in `boundaryDecimation` generation option. It requires
the existing source/selected alpha pair, reference counts and same-attachment padding.
For boundary-only generated meshes and boundary-only reference counts, it tries
removing the lowest local triangle-area vertex, retriangulates and runs the existing
geometric improvement and raster fitter. No reference XY, edge indices, attachment
names or acceptance scores choose candidates. Manual edges and interior/strip
topology are preserved by bypassing this operation.

Each successful removal must retain valid triangles, zero excluded foreground,
missed selected foreground at most 2%, and the unchanged padding budget. The
requested count is a target, not permission to discard coverage. If no candidate
fits, the last valid mesh remains; this does not imply that count or topology passes.
The independent per-attachment count, position and typed-edge rules are unchanged.

Work limits: at most 64 initial vertices, 150,000 pixels, initial hull-count squared
times raster height at most 1,000,000, and 128 removal attempts. Exceeding these
limits bypasses decimation, not the normal raster check. The 1.5-pixel displacement
bound applies to each individual fit, not the accumulated sequence. Arbitrary
display bounds retain actual vertex/UV values and final raster checks.

## Prototype evidence (not the full Gate)

The earlier saved-output experiment used region-14 seeds and 26 candidates. A new
experiment regenerated each seed with the current region-15 engine, asserted exact
baseline equality, and tested 24 qualifying candidates. Three new complete static
passes each reproduced identically in 100 fresh generation-plus-decimation runs:
panda `2_hand_R2`, panda `3_hand_L3`, and pig `1_foot_R`.

Other cases worsened position correspondence even though counts improved. No
reference-score-based choice between old and new candidates was added. These
experiments do not substitute for full-corpus acceptance or generalization evidence.

## Verification

Astra's implementation and initial four tests were saved before its agent hit a
usage limit. The primary agent inspected them and ran the full verification:
formatting, lint, typecheck and 160 tests passed. A further synthetic strip test
confirms that requesting decimation leaves all 19 manual edges unchanged; all five
decimation tests pass. Final full verification passed formatting, lint, typecheck
and **161 tests in 19 files**. No claim of Gate approval follows from these tests.

## Full-corpus evidence: decimate-18, 2026-10-02

| Check                  | region-15 | decimate-18 |
| ---------------------- | --------: | ----------: |
| Primary meshes         |       164 |         164 |
| Generated              |       138 |         138 |
| Count passes           |       107 |         114 |
| Position passes        |        24 |          25 |
| Coverage passes        |       138 |         138 |
| Complete static passes |        19 |          22 |
| Blocked / rejected     |  26 / 119 |    26 / 116 |

All 19 earlier complete passes remain passes. All current 22 complete passes have
100 identical fresh-generation runs; other cases ran twice or were blocked.
Original project/export hashes are unchanged. The independent full-corpus precheck
is **REJECTED**, with 391 failure entries (not a unique failed-attachment count).
Formal Jev was not submitted and GitHub was not pushed.

| Newly passing attachment | Artist/generated count | Max position / diagonal | Missed target | Generated/artist padding pixels | Automatic recall |
| ------------------------ | ---------------------: | ----------------------: | ------------: | ------------------------------: | ---------------: |
| panda `2_hand_R2`        |                  9 / 9 |                1.89476% |      1.87313% |                        71 / 117 |             100% |
| panda `3_hand_L3`        |                14 / 14 |                2.36993% |      1.71699% |                         15 / 26 |        81.81818% |
| pig `1_foot_R`           |                  8 / 8 |                3.72409% |      0.82645% |                        62 / 101 |              80% |

All three preserve 100% hull recall, require no manual internal edges, and
reintroduce zero excluded foreground pixels. This is static reference conformity,
not Spine playback or independent unseen-image generation.

Private report, independently checked review data, HTML and `review-hand.png` live
under `gate32r-evidence/decimate-18/` outside the repository. The screenshot is an
actual JSON/PNG comparison, not a Spine-editor capture. Generator source SHA256:
`C8C6BAA25E0F3C15AF11E19D5EA91A93A14E7C363076B5EFF36B38B790C12353`;
built generator SHA256:
`110CCCA6289B1DE6EDDFBE63ABD8EAF0AF9C9E2C274CE9C07608ACA6786CEAB3`.

The owner subsequently requested that passing tests not be rerun unnecessarily.
Future iterations preserve evidence for unaffected passes and target failures plus
regressions actually affected by a change. Old evidence must retain its run/source
identity; it must not be relabelled as fresh evidence for a changed generation path.
The already-started full-corpus run is allowed to finish; no additional full test run
is needed for documentation-only changes.

Private evidence stays outside Git. No original Spine, PNG or tutorial asset was
edited or uploaded. Karpathy guidelines kept the change opt-in and confined to
generation, regression tests and transparent evidence reporting.
