<!-- Generated from docs/adr/ADR-046-newer-spine-editor.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# ADR-046 — delivering to a newer Spine editor

Status: Accepted
Date: 2026-10-23 (plugin 0.5.12)

## Context

`deliver` imported every project with `Spine -u 4.0.64`, and the plan runbook, user guide and README asked for Spine 4.0.64. A team working in Spine 4.1 or 4.2 had two ways in:

- open the 4.0 project in their editor;
- Import Data on the JSON delivered without Spine.

The second loses data. On 2026-10-23, the delivered Panda (`Panda_Rebuilt`, 61 bones, 46 weighted meshes, 5 animations) was imported into Spine 4.2.43 from its 4.0 JSON and exported again:

- bones, slots, meshes, weights, bone and slot keys came through unchanged;
- every deform key was gone: 150 deform timelines and 18,514 keys over the five animations, 0 after.

4.1 moved deform keys under `animations.<a>.attachments.<skin>.<slot>.<attachment>.deform`, and the 4.2 importer does not read the 4.0 place. A small skeleton with an ADR-035 kept bone (`transform: noScaleOrReflection`) lost that setting the same way; 4.2 names it `inherit`.

## Decision

- `deliver --spine-version=<v>` (`DeliverOptions.spineVersion`) names the editor for `-u`: `4.2`, `4.1`, or an exact `4.2.43`. The default stays 4.0.64.
  - A version below 4.0 or not in that form stops with `CLI_SPINE_VERSION` before the fit, the videos or any file is written.
  - The launcher fetches a version it does not have the first time.
- `forEditorVersion(document, version)` (`@autospine/spine`) lays the 4.0 document out for that editor. Both the imported file and the JSON delivered without Spine use it.
  - From 4.1, deform keys move under `attachments`.
  - From 4.2, a bone's `transform` becomes `inherit`.
  - `skeleton.spine` names the version.
  - Nothing else AutoSpine writes reads differently in 4.1 or 4.2.
- The delivery reports `spineVersion`.
- Reviews and comparisons still play the build's 4.0 JSON on the 4.0 runtime.
- A project a newer editor saved cannot be opened by Spine 4.0 again.

## Evidence

- `tests/character-deliver.test.ts`:
  - `spineVersionArg` keeps 4.0.64 by default, takes 4.2 and 4.2.43, refuses `latest` and 3.8.99. A bad version stops `deliver` before the delivery folder exists.
  - `forEditorVersion`:
    - 4.0 returns the document itself.
    - 4.2 moves two deform timelines under `attachments` with the same keys, renames the kept bone's `transform`, sets `4.2.0`, and leaves an animation with no deform alone.
    - 4.1 moves the keys and keeps `transform`.
    - The input is not changed.
  - The editor's command line gets `-u 4.2.43` (fake Spine, not on Windows).
- **Panda** (`deliver … --spine-version=4.2 --no-video --no-reference`, Spine 4.2.43, then exported to JSON) against the 4.0 build. Unchanged:
  - 61 bones with the same setup;
  - 44 slots and 46 meshes;
  - every bone key (final 15,288, idle 4,743, idle_slow 5,508, wild 732, win 4,209) and slot key;
  - every deform timeline and key (final 46/8,405, idle 39/3,023, idle_slow 39/3,086, wild 4/378, win 22/3,622).

  The one difference is `2_tail`: the editor drops a weight of 0 (vertex 26 on `2_tail_2`) and its two deform offsets. The other offsets of all 147, 87 and 70 keys match.

- **Kept bone**, Spine 4.2.43:
  - converted: the head comes back `inherit: noScaleOrReflection`, with the hips' stepped scale −1 key;
  - left in the 4.0 layout: the head comes back with no inheritance setting.
