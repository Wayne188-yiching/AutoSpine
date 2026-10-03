# Gate 3.2 — structural-family integration, 2026-09-30

Status: **IN_DEVELOPMENT / formal Jev NOT_SUBMITTED / not pushed**.

## Jev decision and evidence boundary

The owner explicitly approved the additional prepared derived-data request.
`GATE_3_2_STRUCTURE_DECISION.json` records the actual `jev-1.13.0` choices:
`STRUCTURAL_FAMILIES`, `KEEP_EXPERIMENTAL`, and `REMAIN_IN_DEVELOPMENT`.
Usage: **1,901 input + 185 output = 2,086 tokens**. The recorded request SHA-256
matches `GATE_3_2_STRUCTURE_REQUEST.json`. Its pre-submission authorization label
was preserved; authority came from the owner's subsequent affirmative reply.
No private image, video, Spine project, coordinate array, or credential was sent.
This was design advice, not visual inspection or formal Gate acceptance.

The earlier midpoint-only, uniform-outline and pure-curvature experiments remain
outside production. The integrated rule is a separate complete structural family:
bilateral alpha silhouette fit plus interval regularity, budgeted widening, and
actual spine/crossbar constraints. It first passed a complete experimental case and
100 deterministic runs under `strip-10-verified/` in the private evidence directory.

## Production change

`referenceTopology.family` is optional: `strip-spine` or `strip-ladder`. It requires
the same-attachment padding budget and cannot be combined with normalized `bands`.
No family means the existing generation path is unchanged. Explicit family failures
are errors rather than an unreported switch to another algorithm.

The generator receives alpha, counts, padding and a coarse family label, not expected
coordinates or connectivity. It fits fixed-count scanline knots by dynamic programming:
normalized bilateral silhouette squared residual plus relative interval-length error.
The optimization is over raster scanline knots, not all possible meshes or artistic
intentions. Widening is monotone and preserves interior spine coordinates. Pixel
coverage and same-attachment padding limits are unchanged.

Work is bounded before the quadratic fit: at most 1,024 axial scanlines and 16 million
segment/scanline-pair operations, with 1–64 interior stations. Count incompatibility,
too few occupied rows, degenerate geometry and failed pixel budgets are rejected.
The existing mesh validator checks the actual final edges and triangles, including
after conversion from PNG coordinates to display bounds.

The developer-only corpus audit can explicitly enable `referenceStructureFamilies`.
Its classifier reads already-validated reference manual connectivity, checks a connected
interior spine or ladder degree pattern, elongated dimensions and compatible counts,
then returns only a coarse label. It never passes the reference graph or XY to the
engine. This is **additional reference conditioning**, not independent semantic
recognition. It has no filename switches and does not choose candidates by comparing
their output to ground truth. The configuration hash and per-case family provenance
are recorded in the report and disclosed on the review page.

## Full primary corpus, structure-11

| Check                  | clipcaps-08 | structure-11 |
| ---------------------- | ----------: | -----------: |
| Primary mesh cases     |         164 |          164 |
| Generated              |         147 |          146 |
| Count passes           |         112 |          111 |
| Position passes        |          23 |           24 |
| Coverage passes        |          62 |           62 |
| Complete static passes |          17 |           18 |
| Blocked / rejected     |    17 / 130 |     18 / 128 |

All earlier 17 static passes remain passes. All 18 current static-pass cases completed
100 identical runs; the remaining cases have two runs or are blocked. Source-project
and exported-JSON hashes match the preceding baseline. The independent full-corpus
precheck still **rejects**; this is not a 164-case acceptance or a formal Jev submission.

Three cases received `strip-spine` by the same structural classifier:

- **F_Hair08 passes**: 21 versus 21 vertices, maximum position error **4.9923683%**
  of PNG diagonal, missed effective foreground **41/2174 = 1.8859246%**, transparent
  padding 11.22355% versus artist 70.51518%, no excluded foreground reintroduced,
  hull/manual recall 100% and automatic recall 18/22 (81.81818%). Its position margin
  is small; no robustness or unseen-image generalization claim follows.
- **F_Hair06 still fails**: count and pixel coverage pass, manual and automatic edges
  pass, but maximum position error is 7.6848% and hull recall is incomplete.
- **R_Thigh is blocked** by `STRIP_MISSED_BUDGET`. A single-spine connectivity label
  alone does not establish that this limited strip geometry fits. Its former result
  was also a complete-case failure. The decreased generated/count totals are disclosed,
  not hidden by a silent fallback or removal from the denominator.

Private evidence is outside Git: `gate32r-evidence/structure-11/` contains the report,
independent review data, review page and visually inspected `review-hair.png`.
New tutorial references remain supplemental, outside the primary denominator.

## Verification and next work

Portable checks cover both orientations and structural families, actual edge validity,
100 repeated synthetic outputs, filename independence, display-bound transforms,
invalid profile rejection, complexity limits, failed pixel fits and independent
pixel counting on a curved synthetic strip. Family classification tests include
disconnected cycles, branching graphs and broad-patch rejection. `npm run verify`
passed formatting, lint, type checking and **142 tests in 17 test files** after
integration. The installed Spine runtime emitted non-failing missing-sourcemap
warnings. These portable checks are separate from the full-corpus acceptance result.

Remaining work is still the entire Gate: boundary features not represented by paired
stations, other topology families, blocked source-region cases, full-corpus repeat
evidence and formal Jev acceptance. The Karpathy guidelines kept the new behavior
opt-in, the old path unchanged, and unsupported cases explicit. No private evidence,
source art or credentials may enter the eventual source-only GitHub push.
