# Gate 3.2 — curved-ribbon experiment (not integrated)

The accepted evidence inventory remains **23/164 complete static passes** from
collapse-20; full Gate acceptance, formal Jev and GitHub push remain incomplete.
This experiment produced no additional complete pass and changed no engine code.

## Motivation and method

The failed F_Hair01 case has 24 boundary vertices in both artist and generated
meshes, yet the generated distribution along the strand differs substantially.
Count reduction alone is insufficient. The observed artist padding budget is
1065 transparent pixels per 1096 selected foreground pixels; the original
contour-hugging output uses much less padding but fails position and typed edges.

Astra wrote a private prototype, preceded by a single-file HTML plan. It thins the
alpha mask, extracts an approximate skeleton-diameter path, smooths it, samples
12 equally spaced arc-length stations, and creates paired normal-side boundary
points. A fixed quarter-pixel common-margin search selects the first mesh meeting
unchanged raster budgets; reference coordinates, edge indices and comparison
scores do not choose candidates. Reference-conditioned selected alpha, count and
padding remain explicit inputs, not independent semantic inference.

## Measured result

Only the failed F_Hair01 attachment was generated, once. Previously passing cases
were not rerun. The first feasible common margin was 2.25 PNG pixels.

| Check                                 |                   Result |
| ------------------------------------- | -----------------------: |
| Artist / generated vertices           |                  24 / 24 |
| Geometry                              |                    valid |
| Missed selected foreground            |   21 / 1096 = 1.9160584% |
| Generated / artist transparent pixels |              1016 / 1065 |
| Excluded foreground reintroduced      |                        0 |
| Maximum position error / PNG diagonal |     8.8974340%, fails 5% |
| Hull edge recall                      |      19 / 24, fails 100% |
| Manual edge recall                    | no required manual edges |
| Automatic edge recall                 |        7 / 21, fails 80% |
| Complete static result                |                 REJECTED |

The previous count-matched result had 16.5547% maximum position error. This local
improvement does not establish a generally better generator or a complete pass.

## Limitations and next discriminating experiment

The path uses unit-cost eight-neighbor BFS, not a Euclidean geodesic solver; mask
border pixels are not thinned. All 216 skeleton pixels were connected in this
case, but this does not validate branched or disconnected artwork. Equal arc-length
stations remain different from artist feature-aligned station placement.

The prototype uses earcut alone, unlike the production angle-improvement pass, so
the automatic-edge deficit cannot be attributed solely to station placement.
The next bounded investigation should separate these effects: alpha-derived
curvature/bilateral contour error for stations, and local paired-strip triangles
versus the existing production triangulation. Choose candidates by geometry and
raster constraints, never by expected artist edges or coordinates. No broader
family selection or production integration is justified yet.

The private `ribbon-22-plan.html`, prototype, measured JSON and comparison HTML
remain outside Git. Original artwork was not edited or uploaded. Karpathy guidelines
kept a failing experiment separate from the tested production path.
