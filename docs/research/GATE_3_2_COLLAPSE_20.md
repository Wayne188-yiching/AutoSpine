# Gate 3.2 — post-stall midpoint fallback and incremental evidence

Status: **IN_DEVELOPMENT / formal Jev NOT_SUBMITTED / not pushed**.

## Geometric change

Astra added a bounded fallback only after the existing boundary-deletion search
exhausts its candidates without finding a valid removal, but before its 128-attempt
budget is exhausted. It considers adjacent edges in length-squared/index order,
replaces the pair by its raster-space midpoint, retriangulates and runs the unchanged
mesh validator and raster fitter. At most 64 midpoint candidates are tried over the
whole generation. A successful merge returns to the original deletion loop.

Only the merged point receives new display coordinates/UVs; other values are retained.
Tail-to-head adjacency uses the same cyclic indexing. Neither midpoint merging nor
multiple fits have a cumulative 1.5-pixel displacement promise. The independent
position limit, zero excluded overlap, missed foreground <=2%, same-attachment
padding, absolute count +/-5 and typed-edge requirements remain unchanged.

Candidate selection uses geometry and pixels, not reference XY, expected edges,
attachment names or acceptance scores. Supporting-line intersection was not added.
An unsuccessful bounded search still returns its last valid mesh for independent
rejection; it does not claim geometric impossibility.

## Targeted verification, not a new full-suite claim

The owner requested no unnecessary reruns of passing tests. The earlier 161-test
full-suite result remains historical. This change ran only one new midpoint test
and the one affected existing partial-reduction test, separately; both passed,
with five other tests skipped in each invocation. Build, typecheck, changed-file
lint and formatting also passed. No other previously passing tests were rerun.
The new synthetic fixture checks five output vertices where deletion alone stopped
at six, deterministic output, input immutability and independent measurement of
actual display geometry. A dedicated executed wraparound regression is not yet
present; cyclic indexing was reviewed.

## Incremental source/evidence proof

The new generated JavaScript has exactly two marked insertion regions. Removing
those regions reconstructs the previous built generator byte-for-byte, SHA256
`110ccca6289b1de6eddfbe63abd8eaf0af9c9e2c274ce9c07608aca6786ceab3`.
The current built generator SHA256 is
`d4b8777cd92498bb3332a09b35f5043d3fec190d18fe4e6a0ae8b3fbb900a8e7`.
The private incremental runner checks this proof before generation, plus every
existing source-project, export and PNG hash. This proof is specific to these
insertions, not a generic permission to reuse evidence after arbitrary changes.

All 22 prior complete passes reached their target counts without a stalled deletion
step, so the new branch is not entered. Other reused records either bypass this
boundary-only path or fail before reaching it. Only three recorded outputs remain
above target in the eligible path: panda `all_shadow`, pig `1_arrow`, pig `1_arrow3`.
Only those three are regenerated. The remaining 161 mesh records retain baseline
identities and run evidence rather than being labelled fresh. The review page
discloses both counts and dates. Full-corpus independent checks still include all
164 records; reused generation is not a smaller acceptance denominator.

## Completed incremental evidence: collapse-20, 2026-10-03

The private midpoint experiment produced one new single-run static pass:
pig `1_arrow`, 14 -> 13 vertices, maximum position error 2.8972% of PNG diagonal,
100% hull recall and 80% automatic-edge recall. The other two remain rejected.
The current-engine run finished and saved its report at 00:01 local time. The new
arrow pass reproduced identically in 100 fresh-generation runs. The other two
affected cases ran twice and remain rejected. No prior passing case was regenerated.

The combined evidence remains 164 meshes: 138 generated, 114 count passes,
25 position passes, 138 coverage passes, **23 complete static passes**, 26 blocked
and 115 rejected. Twenty-two passes retain their unchanged-path 100-run evidence
from decimate-18; one has new 100-run evidence. The full independent precheck is
**REJECTED** with 389 failure entries, not 389 failed attachments.

The new arrow has 13/13 vertices, 2.8971988% maximum position error, 187/9353
missed selected pixels (1.9993585%, close to the unchanged 2% boundary), 437
transparent pixels versus the artist's 1094, and zero of the 12719 excluded pixels
reintroduced. Hull recall is 13/13; there are no required manual internal edges;
automatic-edge recall is 8/10. These exact values must not be rounded into a
relaxed coverage threshold.

Private `collapse-20/report.json`, `review-data.json`, `review.html`, and
`review-arrow.png` record the combined results and explicit reused/fresh provenance.
The screenshot is an actual PNG/JSON overlay, not a Spine-editor capture.
Formal Jev remains unsubmitted; GitHub was not pushed. No Gate approval follows
from a partial static pass count.

A separate bounded supporting-line-intersection experiment on only the two still
failing cases reduced both to requested counts, but neither passed: panda
`all_shadow` retained only 40% automatic edges; pig `1_arrow3` reached 7.81296%
maximum position error and failed typed edges. This private experiment was not
integrated. Counts alone remain insufficient.

Karpathy guidelines kept the new branch isolated and testable. Source artwork and
private experiment/report files remain outside Git and were not uploaded.
