<!-- Generated from docs/adr/ADR-054-delivery-item-folder.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# ADR-054 — checking the delivery item folder

Status: Accepted
Date: 2026-11-16 (plugin 0.5.25)
Builds on: ADR-053 (game-runtime delivery)

## Context

ADR-053 checks the skeleton (JSON) and, with `--export`, the runtime export. The rest of a delivery is files around them, and the conventions for those were left as manual items:

- the folders a delivered item keeps: the layered `.psd` (not PSB, under 2 GB), and `Images/`, `Previews/` with the preview `.mp4`, and `Export/` beside each `.spine`;
- images left in `Images/` that nothing draws, and image names the runtime cannot read;
- static symbol images, which must have even sizes: the runtime centres them at size / 2, and an odd size lands half a pixel off;
- the files of a loading page and a lobby icon, which have fixed names and sizes.

## Decision

- `check-delivery` checks an item folder, F1–F5, `checkFolder` in `packages/cli/src/delivery.ts`:
  - F1: no `.spine` (warning), a missing `Images`, `Previews` or `Export` beside a `.spine`, a `Previews` without `.mp4`, a `.psb`, a `.psd` over 2 GB; no `.psd` is a warning.
  - F2: in the skeleton's `Images/`, names outside the target's characters (error) and images no region or mesh attachment draws (warning; `attachmentImagePaths` in `@autospine/spine`, sequences expanded). Paths with a part starting with `_` are reference images and skipped: E3 reports them if they are exported. When several `.spine` files share one `Images/`, unused images are not checked and a warning says so.
  - F3: for the symbol kinds (`SYMBOL_KINDS`), every PNG or JPEG outside `Images/`, folders whose name contains `psd` (layer exports) and atlas pages must have even width and height.
  - F4: `--kind=loading`: `*_Loading_Bg.jpg` is 840×840 or 840×360 / 360×840. The page rule and the landscape/portrait template differ; both pass and the message names both. `--kind=icon` (new kind, no limits): `Icon_*.png` is 200×400.
  - F5: the delivery names of `loading` (`_Loading.skel`, `_Loading_Bg.jpg`, `_Loading_Logo.png`, `_影片.mp4`) and `icon` (`Icon_*.png`, `Spine_*.skel`, `影片_*.mp4`).
- For a `.spine` input the folder is the one the project is in, by default. `--folder=<dir>` names another (an item folder above it, or the folder of a JSON); `--no-folder` checks the skeleton only. The `Export` folder beside the skeleton is checked as the runtime export (E1–E3) when `--export` is not given.
- The result adds `folder` and `exportImageBytes` (image files in `Export` folders). The CLI prints the size as a reference: the budget counts the runtime's texture format.
- The MCP tool is unchanged: it reads workspace JSON only.

## Consequences

- Image sizes are read from PNG and JPEG headers; other formats are not measured.
- F3 cannot tell a static symbol from any other image outside `Images/`, the PSD folders and atlas pages; an extra image placed there with an odd size is reported.
- Recording rules for the previews (length, repeats) and the PSD's layers still need a look.

## Evidence

- `tests/delivery-check.test.ts`: a symbol folder with a `.psb`, no `.psd`, a `Previews` without `.mp4`, no `Export`, an unused image, a reference image, a badly named image, an odd static image and an odd layer export under `PSD/` gives exactly the F1–F3 rows expected; the same skeleton without a folder gives no F row. A loading folder reports only the missing logo, finds its `Export` (E1 passes on a 3.8.99 `.skel`) and sums its images; a 1680×720 background fails F4. An icon folder reports the 200×401 image and the missing preview.
- On two local item folders, checked against an independent script of the same conventions: a loading template (missing `Previews`, two unused images, the missing preview video, two exported `_` images) and a card (an export made in 4.0.56 with Unity file names for Cocos) gave the same findings, except the reference images under `_Temp/`, which this check skips by design, and the odd-sized layer exports under `PSD/`, which the other script reports as static symbols.
