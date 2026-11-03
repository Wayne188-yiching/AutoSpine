# ADR-053 — delivering to a game runtime

Status: Accepted
Date: 2026-11-03 (plugin 0.5.23)
Builds on: ADR-046 (newer editors), ADR-047 (Spine 3.8)

## Context

A Spine project that goes into a game, not only into an artist's hands, has to meet the runtime's conventions: the editor version the runtime reads (Cocos Creator on Spine 3.8.99, Unity on 4.0.56 or 4.1.24), the binary file names, names the runtime and file system read alike, an untouched root with one `Actor` bone holding the asset, normal and additive blends only, few clipping masks, at most five bones per weighted vertex, and per-kind limits on bones, triangles and draw calls. Teams checked these by hand in the editor and missed some; AutoSpine's own deliveries put the bones straight under the root.

## Decision

- `checkDelivery(document, target, { kind, largeBoard, version })` in `@autospine/spine` checks a 3.8 or 4.x Spine JSON and returns rows with a rule id and `error` or `warning`: V1 editor version, N1 names, R1–R3 root and Actor, S1–S5 blends, `_Add`, points, clipping and empty slots, U1 the Unity setup pose, W1 weights, T1 language text and numbers, L1–L3 limits, A1–A3 first keys, loop seams and chained parts, K1 win tiers and loading pages. `pass` means no errors.
- CLI `check-delivery <skeleton.json|project.spine> --target=cocos|unity|unity-4.1 [--kind] [--large-board] [--export=dir] [--spine=exe]` (exit 2 when not passed). A `.spine` is exported with the target's editor; a project that editor cannot open is exported with the version named in the refusal and fails V1. `--export` adds E1–E3: binary skeleton extension and version, JSON left in the export, atlas page size (2048; square power of two for Unity; the kind's page as a warning), image names and `_` reference images.
- MCP `autospine_check_delivery` checks a workspace JSON, read-only.
- `deliver --target=<runtime> [--kind] [--large-board]` delivers with the target's editor version unless `--spine-version` is given, inserts the `Actor` bone (`withActorBone`), and reports `check` in its output. The check never blocks a delivery. Reviews and comparisons still play the build as built.
- `withActorBone` moves the root's transform, keys, children (not `_` reference bones), slots and constraint references to a new `Actor` at index 1, and shifts every weighted vertex's bone index by one (the root's own weights go to Actor). World transforms are unchanged; the test plays both documents against each other on the official runtime.
- The rules and the reasons for the manual ones are in `skills/autospine/references/delivery-conventions.md`. They are written as general Spine game-delivery practice; a project's own conventions take precedence, and differences are reported, not chosen.

## Consequences

- Delivering for a runtime is one flag, and the delivered project round-trips through the target editor: the example character imported into Spine 4.0.56 and 3.8.99 and re-exported passes its own check.
- The check reads JSON only. Triangles inside a mask, peak triangles while animating and real draw calls need the editor's Metrics view; draw calls are estimated from blend changes in draw order. Texture budgets are measured on the compressed runtime format, not the PNG sizes.
- Slots are not renamed: an additive slot without `_Add` is reported for the artist to rename, because the name is referenced across skins, keys and draw order.
- Kind limits are fixed tables; a project with other limits passes `--kind=other` and checks its own numbers.
