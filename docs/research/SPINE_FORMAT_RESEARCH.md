# Gate 1 Spine 4.0.64 format evidence

Target: Spine Editor **4.0.64**. The official JavaScript runtime package used for load tests is `@esotericsoftware/spine-core@4.0.31`, the published 4.0 runtime line available during Gate 1. Spine's [versioning guidance](https://esotericsoftware.com/spine-versioning) requires editor and runtime **major.minor** alignment; the editor and runtime patch numbers need not be equal.

## Reproducible fixture

- `fixtures/spine/minimal/import-seed.json` is an original, hand-authored seed used only to create a project. It is **not** the golden export.
- `fixtures/spine/minimal/minimal-4.0.64.spine` is the editable project imported with the licensed 4.0.64 CLI.
- `fixtures/spine/minimal/export/minimal.json`, `.atlas`, and `.png` are the **actual 4.0.64 editor export**. `images/square.png` is an original test image.
- `fixtures/spine/minimal/input.json` is the minimal AutoSpine IR input; `compiled.json` is the expected adapter output.
- The JSON golden test removes only editor-generated `skeleton.hash` and machine-specific `skeleton.audio` before comparing all supported structure and values. `skeleton.images` is compared.

## Verified behavior

| Finding                                                                                                                              | Evidence                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skeleton metadata declares `spine: "4.0.64"`.                                                                                        | Actual editor export and CLI import.                                                                                                                                                                                                           |
| Bones appear parent-first; child setup `length`, `x`, `y` are preserved.                                                             | Actual export and official 4.0 runtime load.                                                                                                                                                                                                   |
| Slot references a bone and initial attachment by name.                                                                               | Actual export and runtime load.                                                                                                                                                                                                                |
| Default skin uses a list entry with nested slot and region names.                                                                    | Actual export and [official JSON format guide](https://esotericsoftware.com/spine-json-format).                                                                                                                                                |
| Region dimensions are width and height in the attachment object.                                                                     | Actual export, atlas, and runtime load.                                                                                                                                                                                                        |
| Rotation timeline key uses `value`; zero-valued/time-zero fields may be omitted.                                                     | Actual 4.0.64 export, [official 4.0 branch example](https://github.com/EsotericSoftware/spine-runtimes/blob/4.0/examples/spineboy/export/spineboy-pro.json), and runtime parser. Current online format examples for newer versions can differ. |
| Spine CLI imports compiled JSON into an editable `.spine` project and re-exports matching supported JSON semantics plus atlas image. | Local 4.0.64 CLI `-i/-o/-r`, `-e json+pack`, and `-i` info checks; see [official CLI guide](https://esotericsoftware.com/spine-command-line-interface).                                                                                        |

The import and re-export produced a JSON document whose complete supported structure matched `compiled.json` after excluding the same two editor-only metadata fields. The runtime loaded two bones, one slot, one animation of one second, and the exported atlas region. CLI returned exit code 0.

## Gate 1 scope and limits

The compiler accepts exactly two bones (one root and its direct child), one asset part, one slot/region binding, and one explicit bone-rotation timeline. It sorts bones parent-first, preserves setup x/y/rotation, emits default values according to the fixture, validates IDs/references and key order, and rejects procedural motions. `AnimationSpec.rotationTimelines` adds explicit keyframes to the existing pre-MVP IR; it does not implement procedural animation generation. The explicit binding offsets are already bone-local Spine values. Arbitrary canvas-to-bone placement, meshes, weights, constraints, skins beyond default, and animation curves are **not** verified or implemented.

This evidence establishes compatibility for the minimal slice, not all of Spine 4.0.64. Later Gates must add their own real exports and runtime tests before expanding the adapter.
