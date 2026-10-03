# Gate 3.2 — Jev design decision and local verification, 2026-09-30

Status: **IN_DEVELOPMENT / formal acceptance NOT_SUBMITTED**.

The owner explicitly authorized the prepared derived-data design request to TypeSafe,
including credit usage. `docs/reviews/GATE_3_2_DESIGN_DECISION.json` records the real
`jev-1.13.0` response: 2,135 input and 225 output tokens (2,360 total). Its request hash
matches the preserved bytes of `GATE_3_2_DESIGN_REQUEST.json`; formatting intentionally
excludes that submitted payload. No PNG, video, Spine source, or credential was sent.
Jev received historical measurements and textual frame observations, not visual access.

## Decisions implemented

- Keep absolute vertex count ±5, missed artist-used foreground ≤2%, same-attachment
  padding limit and zero reintroduction of excluded foreground.
- Use hull/interior bottleneck matching, maximum displacement ≤5% PNG diagonal.
  Unmatched hull points measure to the counterpart hull segments; unmatched interior
  points measure only to counterpart interior vertices. Missing interior category fails.
  Mean/P95 remain descriptive, not additional acceptance thresholds.
- Compare typed hull/manual/automatic edges in both audit routes. Recall requirements
  are 100%/100%/80%. Same-type subdivision paths may deviate at most one pixel from
  the mapped segment, with monotone projection and no mapped intermediate feature deletion.
  Labels missing from actual triangles cannot pass. Independent mesh validation remains mandatory.
- `MeshSpec-0.1` has an additive optional engine-neutral `manualEdges` field.
  `constrainMeshEdges` recovers requested edges by retriangulating crossed triangle strips,
  preserves vertices/UVs, splits at existing collinear vertices, and rejects crossing or
  invalid constraints. This is an explicit geometry API, **not automatic feature extraction**.
  It is not fed reference connectivity in the private generation audit.
- Qualified four-corner references now use a fixed top-right/bottom-left diagonal tie-break.
  The two rectangle diagonals have equal angle quality. This uniform profile rule takes
  no per-case artist XY/connectivity, changes no vertex positions, and preserves no-reference behavior.

## This computer's evidence

The owner warned that the 164 attachments were on another computer. Actual inspection found
local Yuuna/panda/pig source copies with matching source hashes. Spine Professional 4.0.64
freshly exported all three to separate private output directories; all 164 mesh PNGs were
read locally. Sources were not modified. These results are new local runs, not recycled
historical acceptance.

| Check                              | Passed / required |
| ---------------------------------- | ----------------- |
| Mesh generation                    | 147 / 164         |
| Vertex count ±5                    | 112 / 164         |
| Position under v5 policy           | 22 / 164          |
| Coverage/padding                   | 62 / 164          |
| All typed-edge checks              | 18 / 164          |
| All static checks                  | 16 / 164          |
| 100 identical full-generation runs | 16 / 164          |

The other generated cases have two-run diagnostic evidence only. 131 cases are rejected;
17 are blocked by existing alpha discard/fill/correction budgets. The complete precheck
remains REJECTED. The position result is under a **changed, explicitly adjudicated metric**,
not proof that those vertex positions improved. Under the same new v5 checks, the old
rectangle diagonal yielded zero complete static passes; the tie-break restores 16.

Portable verification: `npm run verify` passes formatting, lint, type checks and **125 tests
in 15 files**. Tests include fake manual labels, dashed-for-solid substitution, automatic
diagonal flips, bounded subdivision, unmatched interior categories, all convex-hexagon
diagonals, multi-constraint recovery and deterministic generation. Third-party Spine
sourcemap warnings remain non-fatal.

## Remaining work

No claim of generic semantic understanding, full video/audio review, model training,
posed deformation quality, or official Spine re-edit/round-trip acceptance is made.
The corpus still uses alpha-derived starter meshes and does not automatically infer
the manual feature constraints now representable in the engine.

For example, pig `2_string` has 7 artist vs 9 generated vertices and 1.992% missed
effective foreground, but maximum position error is 9.286% and automatic-edge recall
is 25%; it remains rejected. Structure-aware feature extraction and actual point/edge
placement, not looser count/coverage thresholds, are the next implementation work.

Private evidence is outside Git, under the existing visualization root:
`gate32r-evidence/astra-jev-07/verified/` contains `report.json`, `review-data.json`,
`review.html`, and screenshots. `measured/` and `optimized/` used the pre-tie-break
compiled generator; they are intermediate comparisons, not final evidence. Only
`verified/` reflects the final rebuilt implementation for this slice.

The Karpathy guidelines led to one shared checker, an optional geometry-only constraint
API, a narrow rectangle tie-break, and negative tests rather than unrelated refactoring.
