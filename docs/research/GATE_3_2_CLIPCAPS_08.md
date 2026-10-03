# Gate 3.2 clipped contour caps and supplemental reference intake

2026-09-30. **IN_DEVELOPMENT / formal Jev NOT_SUBMITTED / not pushed.**

## Measured change

The raster-only contour fallback now considers clipping-edge endpoints before
simplification. Its corner fitting tries image-border-pinned and unpinned variants,
then removes redundant corners under the existing silhouette and pixel budgets.
Existing acceptable contours and non-reference generation retain their earlier path.
Neither artist XY coordinates nor artist connectivity is supplied to the generator.

Bottleneck matching still minimizes worst displacement. Within a feasible threshold,
its augmenting search now tries nearer columns first, with stable index tie breaking.
This avoids selecting an earlier surplus point ahead of an exact geometric corner;
it is not a claim of a globally minimum-sum assignment. Thresholds are unchanged.

| Check                  | astra-jev-07 verified | clipcaps-08 |
| ---------------------- | --------------------: | ----------: |
| Total primary meshes   |                   164 |         164 |
| Generated              |                   147 |         147 |
| Count passes           |                   112 |         112 |
| Position passes        |                    22 |          23 |
| Coverage passes        |                    62 |          62 |
| Complete static passes |                    16 |          17 |
| Blocked / rejected     |              17 / 131 |    17 / 130 |

Pig `2_string` now has 7 generated vertices for 7 artist vertices. Its maximum
position error is 0.0833061% of the PNG diagonal, versus 9.2859% previously.
Hull/automatic recall is 100%; it requires no manual interior edges. Missed effective
foreground remains 10/502 (1.9920319%), padding is zero, and none of the 5,360 excluded
original foreground pixels are reintroduced. It passes 100 deterministic runs.
The earlier 16 complete static passes remain passes. This does not imply every
individual metric improves: `1_string` remains rejected (9 versus 7 vertices,
6.2507% maximum displacement, 50% automatic recall).

Portable `npm run verify`: formatting, lint, typecheck and **127 tests / 15 files**
pass. The synthetic bent-ribbon regression has 7 corners, zero added pixels,
at most 2% misses, unchanged input alpha, and filename-independent output. Every
synthetic corner must have a generated vertex within 1.5 pixels. Exact image-border
coordinates are not required: fitting can move inward to satisfy zero padding.
Before/after check against the staged pre-change contour: 10 vs 7 vertices and
2.6 vs 1.03 pixels worst synthetic-corner distance. The old implementation fails
both new geometric assertions. A separate regression covers matching tie order.

Local private evidence: `gate32r-evidence/clipcaps-08/` contains report, independent
precheck, review page and the visually inspected `review-string.png`. Only the 17
static-pass cases have 100 runs; the remaining cases have 2. Formal precheck rejects
the corpus. No formal Jev call or GitHub push was made.

## Additional tutorial references supplied by the owner

The newly named local tutorial folder contains 10 Spine projects, 10 existing JSON
exports and 300 PNGs. Existing JSONs contain 361 mesh attachment instances (skin
variants included, not 361 independent drawings). Warrior and flame JSONs contain
regions only. Most recorded versions are 2.1.x; they are not silently accepted by
the 3.8/4.0 reference parser.

Slug and octopus were read-only exported with installed Spine Professional 4.0.64.
Original project SHA-256 values remained unchanged. Of 13 resulting mesh attachments,
11 pass reference geometry parsing; slug `tant2` and octopus `tant_forw` are quarantined
because a recorded edge is not present in the triangle edge set. This is a reference
consistency issue to investigate, not authorization to discard edges or waive checks.

This supplementary study stays outside the 164-case acceptance denominator. It has
not been used to claim animation playback, deformation quality, full training, or
formal Jev review. Private artifacts under `gate32r-evidence/tutorial-intake-09/`
include hashed intake data, fresh exports, a self-contained reference page and screenshot.
No private source or image is copied into the repository or uploaded.

Visual inspection of `reference-overview.png` shows a concrete next hypothesis:
slug `whis1` (24 vertices, 18 hull) and `whis2` (27 vertices, 21 hull) each use six
interior vertices arranged along the bent strip, with authored cross-strip and
longitudinal connections. The automatic diagonals fill between that structure.
The two sides have nonuniform spacing; uniform triangle-centroid insertion does
not express this construction. This observation motivates an alpha-derived medial
curve and cross-section prototype, not direct reuse of these six coordinates or
a claim that every elongated primary attachment uses this pattern. Slug body and
octopus ball visibly use different interior structures. Structural inference must
therefore be tested by attachment shape rather than applied globally by filename.

Karpathy guidelines kept the changes limited to clipped contours, a matching tie
regression, and explicit evidence boundaries. Next work remains actual structural
feature placement and constraint inference, not a relaxation of acceptance criteria.
