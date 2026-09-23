# Gate 3.1 AWP field test (2026-09-23)

This is a supplementary, read-only test of two artist-authored Spine projects. It does **not** replace Gate 3.1's Jev approval for the Tail-specific acceptance criteria, and it is not an approval of general-purpose mesh quality.

## Reproducible source selection

AWP root: `\\192.168.1.86\art\★H_70T\04_虎機\AWP`. Among discovered `TopRole` character projects and `Symbol` projects under the Zeus `SPINE` directory, fixed PowerShell random seeds `20260923` (character) and `20260924` (symbol) selected:

| Role      | Path relative to AWP root                                                                                                                     | `.spine` SHA-256                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Character | `000_舊遊戲備份資料\3288平台\GAME\154_INFINITE LINK NEON_Lobby\03_後製\Game\宙斯\SPINE\BG宙斯\v1_陳廣澤\ZEUS_BG_TopRole.spine`                | `3F2717052BCD1E5326AC9EFB913F227836A922DF8805803129476FBCD1C9AF84` |
| Symbol    | `000_舊遊戲備份資料\3288平台\GAME\154_INFINITE LINK NEON_Lobby\03_後製\Game\宙斯\SPINE\Symbol_Scatter\v1_陳廣澤\ZEUS_MG_Symbol_Scatter.spine` | `8BA0F79F5AD9A62FB352EA2A1FFD08256A417B22A5D515A2F68F655DD7270C9C` |

Spine CLI 4.0.64 opened each **original `.spine` project** and exported temporary JSON outside this repository. Both project exports identify Spine 4.0.64. The adjacent _previously exported_ character `.skel.bytes` identifies 4.0.56, so this test deliberately does not treat that stale file as the source of truth; the Symbol `.skel.bytes` identifies 4.0.64. Neither `.spine` project, exported skeleton, PNG, nor derived mesh is stored here.

## Project-level observations

| Project                         | Bones | Slots | Skins | Regions | Mesh attachments | Animations | Other                                           |
| ------------------------------- | ----: | ----: | ----: | ------: | ---------------: | ---------: | ----------------------------------------------- |
| Character `ZEUS_BG_TopRole`     |   174 |   111 |     1 |      88 | 52 (32 weighted) |          9 | 1 transform constraint; mesh median 17 vertices |
| Symbol `ZEUS_MG_Symbol_Scatter` |    35 |    37 |     1 |      42 |   8 (7 weighted) |          3 | 1 clipping attachment; mesh median 4 vertices   |

These are attachment counts, including duplicate image uses in different slots, not counts of unique PNGs. The selected character folder contains 135 PNGs; the selected Symbol folder contains 48 PNGs.

## Matched-attachment mesh comparison

Each AutoSpine run used the exact PNG corresponding to the named Spine attachment, the Gate 3.1 `mesh-png` CLI, and the same explicit `0.005` alpha-cleanup fraction used in the private Tail test. `hull` and `interior` count geometric vertices, not weighted influence records. The CLI returned success for all three inputs and a second run of each was byte-identical.

| Source part (PNG SHA-256 prefix)         | Artist mesh vertices (hull + interior) | Artist triangles | AutoSpine vertices (hull + interior) | AutoSpine triangles | Finding                                                                                                       |
| ---------------------------------------- | -------------------------------------: | ---------------: | -----------------------------------: | ------------------: | ------------------------------------------------------------------------------------------------------------- |
| Character `huzi2.png` (`81BEA8EDACA7`)   |                            24 (24 + 0) |               22 |                          51 (46 + 5) |                  54 | 2.13× artist vertex count; overly detailed outline for this small beard piece                                 |
| Character `tou_1_3.png` (`B55EC72EA66B`) |                           80 (27 + 53) |              131 |                          34 (29 + 5) |                  37 | Only 42.5% of artist vertices; insufficient internal structure to claim equivalent head deformation           |
| Symbol `SC_House_B.png` (`B6390F98F2ED`) |                            25 (19 + 6) |               29 |                       275 (35 + 240) |                 513 | 11× artist vertex count; dense regular interior sampling is inappropriate for this rigid-looking house symbol |

Full PNG SHA-256 values, in table order:

- `81BEA8EDACA7192A42A74BE6306A96B70CC3A8E581ADAD2B2FAD7693CEFA4DF6`
- `B55EC72EA66BD5AEFBEA6AC1B710CB83F83A7B5A0634AFF21444A5F334FD1390`
- `B6390F98F2ED123F61071DD35D42764CFCB497E73AC9BC0F19D3F7EC6112BF07`

The PNG dimensions equal the Spine attachment dimensions: `huzi2` 39×59, `tou_1_3` 149×239, and `SC_House_B` 268×242. Cleanup discarded 0, 18, and 17 pixels respectively; the head also filled one pinch and 50 pixels across two holes. This makes the large density differences unlikely to be caused by mismatched images or cleanup.

## Interpretation and next acceptance criterion

Gate 3.1's `>=1.5` aspect-ratio branch gives long parts five internal centerline points, regardless of intended deformation. That is too many total vertices for the small beard outline but far too few interior vertices for the head, which is weighted and has an `Idle` deform timeline. The near-square house enters the earlier uniform-grid branch and receives 240 interior points; the artist mesh has six. Its 25 artist vertices are weighted to one bone and no deform timeline for `SC_House_B` was found in the three exported animations, so a dense deforming mesh is not supported by this example.

Conclusion: Gate 3.1 passes its Tail-specific checks and deterministic/structural checks, but **fails to generalize artist-like density and edge flow across these character and Symbol attachments**. Do not claim production-ready character/Symbol topology or use a global vertex target from the Tail reference. Before accepting wider asset classes, define a topology budget by part role and deformation needs, add these examples as private external regression inputs, compare coverage and animated deformation, and obtain a new Jev review. This field test alone does not alter the approved Gate status or claim visual approval from an artist.
