# Gate 3.2 — explicit selected-raster constraints

Status: **IN_DEVELOPMENT / formal Jev NOT_SUBMITTED / not pushed**.

## Cause and implementation

The selected alpha alone cannot distinguish transparent padding from foreground
deliberately excluded by the artist. Both become zero in that mask, but the existing
acceptance policy allows bounded transparent padding and forbids reintroducing any
excluded source foreground. No acceptance rule is changed here.

The optional `rasterRegion` passes two rasters: original source alpha and selected
foreground before cleanup. Selection remains artist-hull-conditioned and is disclosed;
this is not an independent segmentation claim. The generator does not receive artist
vertex coordinates or connectivity through this option.

`fitRasterRegion` preserves counts, internal points, hull order, triangle connectivity
and manual-edge labels. It searches hull displacements of at most 1.5 PNG pixels,
rejecting invalid mesh candidates. Row-prefix counts distinguish selected foreground,
excluded foreground and transparent background. The objective guides a bounded local
search; final acceptance still requires zero excluded overlap, missed target foreground
at most 2%, and same-attachment transparent padding. An unmet constraint is an explicit
error, not a silent fallback.

The first search bound included image width even though row-prefix queries eliminate
that factor. A larger-case experiment reproduced valid fits for 11 of 14 formerly
excluded-overlap cases. The bound now uses hull-count squared times image height,
limited to 1,000,000 units with at most 40 sweeps and eight neighbors per point.
This remains a bounded local solver, not proof that a blocked case is geometrically
impossible. Raster allocation is separately limited to 16,777,216 pixels.

## Experiments not promoted

Independent boundary-knot insertion did not produce an additional complete pass.
The initial bilateral residual approach worsened a hair reference and produced invalid
triangulation for a thigh; the outward-only variant produced valid coverage but failed
typed-edge correspondence. Both remain private experiments outside production.

The small raster-region prototype measured 69 affected cases: 66 covered correctly,
with one additional complete static pass. These figures were experimental and did not
replace the full-corpus check.

## Measured intermediate full corpus: region-14

The full current source denominator remained 164. Results: 140 generated, 109 count
passes, 24 position passes, 140 coverage passes, 19 complete static passes,
24 blocked and 121 rejected. All previous 18 complete passes were preserved;
all 19 complete-pass cases ran 100 times identically. Other cases ran twice or
were blocked. Source-project and export hashes matched structure-11.

The independent precheck rejected the corpus with 411 failure entries; entries
are not unique failed attachments. No formal Jev request was made.

The new complete pass was panda `3_leg_L1`: 14/14 vertices, maximum position error
3.3859451% of PNG diagonal, missed foreground 181/18738 (0.9659515%), transparent
padding 51 pixels versus artist 83, and zero of 1637 excluded foreground pixels
reintroduced (previously 40). Hull recall 14/14; no required manual internal edges;
automatic-edge recall 10/11 (90.9091%). This is static reference conformity,
not official Spine playback or unseen-image acceptance.

## Astra audit and final verification

An independent Astra review reproduced a fractional-display-transform false pass:
the internal PNG candidate passed but returned display coordinates mapped back to
9.500000000000002 rather than 9.5, including ten forbidden pixel centers.
Astra implemented candidate materialization before scoring: coverage and displacement
are evaluated from the actual display-to-PNG round trip. Each accepted candidate keeps
untouched coordinates and UVs exact, and the returned geometry is checked again. A
1-pixel coarse step precedes the existing subpixel steps so that an exactly-on-boundary
rounding trap does not stall a solvable local search. No exclusion tolerance was added.

The three fractional-transform regressions require successful generation and independently
counted zero excluded pixels, not merely an explicit rejection. Full portable verification
passes formatting, lint, type checking and **156 tests in 18 test files**. Runtime
missing-sourcemap warnings remain non-failing.

## Current full-corpus evidence: region-15, 2026-10-01

| Check                  | structure-11 | region-14 | region-15 |
| ---------------------- | -----------: | --------: | --------: |
| Primary meshes         |          164 |       164 |       164 |
| Generated              |          146 |       140 |       138 |
| Count passes           |          111 |       109 |       107 |
| Position passes        |           24 |        24 |        24 |
| Coverage passes        |           62 |       140 |       138 |
| Complete static passes |           18 |        19 |        19 |
| Blocked / rejected     |     18 / 128 |  24 / 121 |  26 / 119 |

All 19 earlier complete passes remain passes and each completed 100 identical
fresh-generation runs. Other cases ran twice or were blocked. Source-project and
export hashes remain unchanged. The independent precheck **rejects** with 407
failure entries. These entries are not an acceptance score: fewer entries can
result when a blocked case has no generated geometry to compare.

The coarse search changed two former incomplete outputs into explicit
`RASTER_REGION_BUDGET` blocks: Yuuna `L_Upper_Eyelid` and pig `1_arrow2`.
This is a local-search regression, not proof no feasible polygon exists.
It is disclosed rather than hidden by dropping cases or lowering pixel requirements.
The six earlier explicit region-budget failures also remain blocked.

Panda `3_leg_L1` remains a complete pass. Current missed foreground is 173/18738
(0.9232576%); count, maximum position error, transparent padding, excluded overlap
and typed-edge recall are unchanged from the region-14 figures above.
The actual JSON/PNG review page and visually inspected screenshot are in the
private `gate32r-evidence/region-15/` directory (`review.html`, `review-leg.png`).
The image is a measured overlay, not a Spine-editor screenshot.

Private reports, images and prototype scripts remain outside Git. The planned source-only
push still requires the full Gate and formal Jev acceptance. The Karpathy guidelines
kept the integration opt-in, rejected failed experiments and required measurable tests.

## Next geometric experiment, not integrated

A private area-ordered hull-decimation experiment tested 26 boundary-only outputs
from region-14 using the current raster fitter. Three candidates passed a single
static comparison: panda `2_hand_R2`, panda `3_hand_L3`, pig `1_foot_R`.
They have not been counted as production passes or 100-run evidence. The procedure
uses generated geometry, raster constraints, requested count and padding; artist XY
and expected edge indices are not inputs to candidate selection. Many other cases
worsened their position correspondence despite meeting the count. Integration requires
fresh end-to-end generation, synthetic regressions and complete-corpus comparison.
