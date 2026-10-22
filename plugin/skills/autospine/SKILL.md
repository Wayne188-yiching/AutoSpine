---
name: autospine
description: Rig and animate a Spine 4.0 character or prop with the AutoSpine engine — bones, meshes, weights, IK, idle/loop or one-shot motion (entry, win, exit), a review video and handover notes — and compare it with the artist's version. Use when someone asks to 綁骨、做 Spine 動畫、做 idle／呼吸／進場／勝利動畫、自動建骨架網格權重, gives a .spine or Spine JSON with images to animate, or wants an automatic build checked against a hand-made .spine.
---

# AutoSpine

AutoSpine turns an images-only Spine file plus a short brief into an editable Spine 4.0 project: bones, meshes, weights, constraints and sparse keyframed motion, a review video and handover notes. You run the engine; the requester only gives the brief, watches the video and says what to change. Reply in the requester's language.

## 1. Find the engine

Use whichever is available, in this order:

1. **MCP tools named `autospine_*`** (Claude Code, Cowork on the requester's computer, Codex). Their file tools read and write only inside their workspace (`autospine_get_status` reports it; default `~/AutoSpine`), so use them for in-memory work and for projects kept there. For a project folder anywhere else, use the command line for every file step.
2. **The bundled command line**, everywhere else or when a tool you need is missing:

   ```text
   node <skill>/scripts/autospine.mjs <command> ...
   ```

   `<skill>` is this skill's folder: `${CLAUDE_SKILL_DIR}` in Claude, otherwise the folder this SKILL.md was read from. It needs only Node.js 22.12 or later (`node --version`); there is nothing to install. The command line has no workspace limit; the folder rules below still apply.

Run the engine where the files are. If you reach the requester's files only through a file bridge (a cloud session linked to their computer), copy the inputs into your own working folder, run there, and copy the outputs back to a new folder beside the inputs.

Check the install once when it is new or failing: copy `<skill>/assets/example/` to a new folder under `~/AutoSpine/` and run `lint-plan plan.json` then `build-character plan.json build`. It must print a summary with `"bones":20` and `"setupDeviationPx"` below 0.5.

The references and the user guide write commands as `node <skill>/scripts/autospine.mjs`; MCP tool names are given beside them in [the plan runbook](references/character-plan.md).

## 2. Take the brief

Ask only for what is missing, in one message:

- The Spine file: a `.spine` project, or its JSON export with the `images/` folder. Which skeleton if there are several.
- Each animation: name, length in seconds or frames, loop or one-shot (entry, exit, win).
- If the setup stacks several pose sets: which set this animation uses, and a picture of that pose.
- Hands: holding a prop, or resting on a table or forehead. How large props (trees, flags) should sway.
- Blinks (which frames), eye looks.
- **One-shots:** a few key-pose pictures (storyboard or reference-video frames) labelled with frame numbers, start and end included, e.g. `0, 8, 14, 44, 60`. A name alone only guesses the motion ("win" may become a jump). Expressions and mesh deforms are not fitted from pictures.
- A reference video of the motion, if there is one (the artist's render, another project's export, a generated clip): on a single-colour background, starting at the animation's frame 0, or say the second it starts. Every build is then checked against it.
- An artist version to compare with, if one exists. Comparing is optional.
- Where to put the result.

Without a brief, the defaults are a light breath for characters and a small sway for props.

## 3. The project folder

The project folder is where the result goes: the folder the requester named, otherwise `AutoSpine/<animation>/` beside their `.spine` file (one folder per character project; several animations share one). Its top level holds only what the requester uses; every working file goes in `_work/` inside it, in this layout:

```text
<project folder>/
  <Name>.spine        delivered project          (written by deliver)
  <Name>.mp4          review video               (written by deliver)
  <Name>-vs-reference.mp4   reference | build | difference, when the plan has a reference video (written by deliver)
  images/             art the project uses       (written by deliver)
  _work/
    input/            export of their .spine, artist.json, imagesOnly.json, images/, reference pictures and videos
    plans/            plan-01.json, plan-02.json, ... one file per version; the highest is current
    builds/           build-01, build-02, ... one per build (old deliveries move into the build folder)
    checks/           comparisons, pose and key-pose fits, optimiser state, your own test videos
    notes/            anything else you must write: notes, and a script only when no command does the job
```

- Create the layout first with `node <skill>/scripts/autospine.mjs init-project "<project folder>"`. Never write a working file at the top level, and do not leave files outside this layout.
- Prefer editing the plan over writing helper scripts. Save each change as the next `plans/plan-NN.json`; never overwrite an older version.
- Plan paths are relative to the plan file: `"source": { "imagesOnly": "../input/imagesOnly.json", "images": "../input/images" }`.
- Every build and comparison goes into a new folder; the engine refuses existing ones.
- Never write into the requester's original art folders, and never touch a Spine project that is open with unsaved edits.

A `.spine` project is exported to JSON with the Spine 4.0.64 command line (`Spine.com` on Windows, usually `C:\Program Files\Spine\Spine.com`; `/Applications/Spine.app/Contents/MacOS/Spine` on macOS):

```text
"<Spine.com>" -u 4.0.64 -i <their.spine> -o <project>/_work/input/export -e <skill>/assets/spine-export-json.json
```

Then `strip-images <export>/<name>.json <export>/images <project>/_work/input/imagesOnly.json`, and copy the export's images to `_work/input/images/`. If Spine is not installed where you run, ask the requester to export JSON from Spine (File › Export, JSON, nonessential data on) and send it with its images.

## 4. Build

Follow [the plan runbook](references/character-plan.md); the short form:

1. `strip-images <artist.json> <images> _work/input/imagesOnly.json` — keep placements only. Check `summary.over2px` is empty.
2. **Write the plan** as `_work/plans/plan-01.json`. Start from a previous character's plan or `<skill>/assets/example/plan.json`. Part names are slot names (`slot#attachment` for non-setup attachments). Lay out the skeleton by the template in [the engine pipeline](references/engine-pipeline.md): every bone from its joint to the next, soft strands and ornaments as chains, mesh every shown part (`meshing: { all: true }`). Meshes default to artist vertex counts, deforming parts too (ADR-038): give `hullVertices` / `interiorVertices` only where a part folds, and `density: "fine"` only when B1/B3 fail with fewer. Start motion from the measured priors there, not guesses; the brief and references override them. The build re-keys every bone timeline with as few keys as play within `motion.keyTolerance` (default 0.25 degree or px).
3. `lint-plan plan.json` (`autospine_lint_character_plan`) until it reports no errors.
4. `build-character plan.json _work/builds/build-01` (`autospine_build_character`). Check `setupDeviationPx` ≤ 0.5 in `build-record.json`.
5. Pose pictures: `fit-pose plan.json _work/builds/build-01 pose.png pose.json` for a rest pose; `fit-pose plan.json _work/builds/build-01 0=f00.png 14=f14.png ... keyposes.json --animation=<name> --zero=0` for one-shot key poses (`autospine_fit_pose`). Put the result in the plan, build again into a new folder. Pictures with coverage below 0.6 are not used; say which.
6. Check your work with `review-video plan.json <build> [artist.json] _work/checks/check-01.mp4` (or `--reference-video=<video>` to see the reference beside the build) (`autospine_review_video`, needs ffmpeg) when you need to look at it yourself; the requester's video comes from `deliver`.
7. **Reference video**: copy it to `_work/input/` and record it in the plan, `motion.animations[].reference: { "video": "../input/<file>.mp4", "start": <seconds of frame 0> }`. Check a build with `compare-video plan.json <build> _work/checks/video-01 [--animation=<name>]` (`autospine_compare_video` with `videoPath`; needs ffmpeg). It prints V1–V4 as PASS/FAIL with hints and writes `compare.mp4` and `report.json` per animation; exit 2 means not passed. A hint "drawn mirrored (left-right) in the reference on frames a-b" means the reference turns those parts the other way; tell the requester, and if they want it, add `motion.animations[].mirror: { bone, keep, frames: [[a, b]] }` (ADR-035: usually the base, keeping the head). It needs a single-colour background (`CLI_VIDEO` otherwise) and the reference starting at frame 0 (`--start` skips a lead-in).
   - **To follow the video** (the requester asks for it; not for a generated clip that redraws the figure): `fit-video plan.json <build> _work/checks/fit-01 [--animation=<name>]` (`autospine_fit_video` with `videoPath`; ADR-036). It needs `qa.view` and `motion.fps`; fit the rest pose from the video's frame 0 first. It fits every frame over the plan without its guessed main motion, following each part from the frame before in both directions (ADR-039), folds a loop onto the period the video repeats with, keys sparse key poses (a bone that trails the bone it hangs from keeps that lag as `keyposeLag`, ADR-040), and builds and compares up to 3 rounds; `best/` holds the round with the lowest penalty and `best/plan.json` is the plan to continue from (copy it to `_work/plans/`). Exit 2 means no round passed, or a refusal before fitting (frame 0 covers under 0.6: another pose set or other art). Or set `reference.use: "fit"` and `deliver` fits first. Report the rounds, the period and stretch, the keys against the prior and every hint (parts not fitted: expressions, mesh deforms, scale, parts the video redraws; bones the forward and backward tracks disagree on) and the bones kept timed off their parents (`keys.lag`, in the handover notes as `head` 比 `spine` 晚 N 幀). For a run that must not see the artist's Spine file, keep the images and the video in their own folder and report `summary.json` `inputs`. The result is **reference-fitted**, not blind.
8. With an artist version: `compare-reference plan.json <build> artist.json _work/checks/compare-01` (`autospine_compare_reference`). If D1/D2 fail, `optimize-motion plan.json artist.json _work/checks/opt --budget=150` (`autospine_optimize_motion`; exit 3 means run it again to resume), then build with `--params=_work/checks/opt/best-params.json`.
9. Several animations of one character: plan them apart if easier, then `merge-plans _work/plans/plan-NN.json plan-a.json plan-b.json ...` (`autospine_merge_plans`) and build once, so the artist gets **one project per character**.

When a step fails, read its error code and fix the plan; the [pitfalls list](references/character-plan.md#pitfalls-seen-so-far) covers the common ones. Do not edit the engine's output JSON by hand.

## 5. Deliver

Deliver with the command line (the MCP tools cannot write outside their workspace):

```text
node <skill>/scripts/autospine.mjs deliver _work/plans/plan-NN.json _work/builds/build-NN "<project folder>" [_work/input/artist.json] --name=<Name>
```

- It writes `<Name>.spine`, `images/` and `<Name>.mp4` at the top of the project folder, and `<Name>-vs-reference.mp4` (`<Name>-<animation>-vs-reference.mp4` with several animations) for every animation whose plan names a reference video; nothing else. The project points at that `images/`, so the folder opens anywhere. The video plays every animation as wireframe, bones, then plain motion; artist | AutoSpine side by side when an artist file is given.
- Use `--name` for a readable file name such as `RedRobedReindeer`; one project per character holds every animation. `--images=<folder>` delivers other art than the plan's `source.images`.
- Spine's command line is found at the standard install path, or pass `--spine=<path>`. Without Spine it delivers `<Name>.json` instead, for Spine › Import Data; say so.
- Delivering again needs `--replace`; the previous project and video move into that build's folder. If it stops with `CLI_DELIVER_EDITED`, the requester has saved the project in Spine since the last delivery: ask before passing `--force`, because their hand edits would be replaced.
- With reference videos, its output has `reference` (pass, `rows` and `hints` per animation, and the `report` path). `referenceError` means the comparison could not run (missing video, no plain background); the delivery still happened, so say why it was not checked. `--no-reference` skips it. With `use: "fit"` animations, `fitted` lists each fit (pass, best round, folder) and the delivery is that best build; `fitError` means a fit could not run and the build as given was delivered: say why.
- `deliver` reports anything else at the top of the project folder as `stray`. Move each into `_work/notes/` (or the folder it belongs in) before you finish: only `<Name>.spine`, `<Name>.mp4`, the `-vs-reference.mp4` videos, `images/` and `_work/` stay at the top level. A reference video the requester left at the top level is theirs: leave it.

Then tell the requester, in the chat (not as files):

- Where the project and the video are, and what to look at in the video. `_work/` can be deleted once the character is final; it is only needed to change it again.
- The rig in a few lines from `HANDOVER.md` in the build folder: bones by role (blue main, red control, orange face followers, green chains), constraints, what each animation keys. Offer the full notes if they want them.
- With a reference video, the V1–V4 results as PASS/FAIL lines (V1 outline, V2 each part's position, V3 whole-figure timing and size, V4 loop seam), the `hints` in plain words, and the comparison video to watch. **When a row fails, only report it**: say what differs and what could be changed, and let the requester decide. Do not change the plan and rebuild on your own because of a failed row; only a fit the requester asked for (`fit-video`, `use: "fit"`) rebuilds by itself, within its rounds. Numbers that pass still need the video.
- With an artist version, the A–D results as PASS/FAIL lines (A placement and loops, B mesh folds and seams, C parts that should move, D timing and size against the artist). All PASS only means the numbers are close; the video decides. Results tuned against the artist are **benchmark-tuned**, not blind.

Then ask what to change. Feedback such as "the cane should follow the hand" or "sway the tree more" goes into the plan; save the next plan version, build into the next `builds/` folder and deliver again with `--replace`. Hand edits in Spine are not written back to the plan, so the last 5–10 % of polishing is done in Spine after the plan is final.

**Fewer keys for editing** (精簡 Key; any Spine 4.0 project, artist or AutoSpine; ADR-044): `node <skill>/scripts/autospine.mjs reduce-keys "<project>.spine" "<new folder>"` (`autospine_reduce_keys` on workspace JSON, without the editor check). It writes `fidelity/` (保真精簡: the fewest original keys, refitted Beziers) and `posable/` (可編修姿勢: main bones on shared pose frames on whole frames, follow parts on their own turns), each with a `.spine` imported by the editor, its re-export and `key-report.json`, plus `preview.mp4` (original | both) and `key-reduction-report.html`. Each mode has its own world-vertex limit (default 0.1 % / 0.3 % of the skeleton height, RMS 0.03 % / 0.1 %; `--fidelity-max=`, `--posable-max=` px): set it from the project's scale and say why; never raise it to delete more. Report per mode keys before → after and how many came from constant "key all" channels, max/RMS error with the worst frame and part, keys added back and fallbacks, follow lag, contacts, seams and the editor round trip, and list what was not checked. `--lock=<anim>::<timeline>@<s>` keeps keys; `--baseline=<earlier source JSON>` re-reduces an edited result without compounding. For plan builds, `motion.keyReduction: { "mode": "posable" }` does it on every rebuild. The source file is never written.

## 6. Limits

- Expressions (a smile to a closed mouth) are not generated or fitted. A shape the art lacks can be keyed by hand as control-point mesh deforms (`motion.deforms`, with `meshing.parts` for vertex counts; ADR-037), or drawn and swapped (ADR-027). Colours are not checked automatically.
- Mesh deforms, scaling and hands moved off their arms are not fitted from pictures.
- Numeric acceptance is not artist approval; the editor round trip and an artist's review stay separate.

## References

Read only what the current step needs:

- [User guide (中文)](references/user-guide.md) — what the requester sees and can ask for.
- [Plan runbook and plan reference](references/character-plan.md) — every plan block, commands, pitfalls.
- [Engine pipeline](references/engine-pipeline.md) — skeleton template, meshes, weights, motion priors.
- [Rig and deformation rules](references/rig-deformation.md), [controls and animation rules](references/controls-animation.md), [production workflow and capability map](references/production-workflow.md).
- [MCP tools](references/mcp-tools.md) — every `autospine_*` tool and its limits.
- [Spine application knowledge](references/spine-application-knowledge.md), [tutorial engineering notes](references/spine-tutorial-notes.md).
- `references/adr/` — why each engine rule exists (ADR-017 plans, ADR-024 rest pose, ADR-031 one project per character, ADR-033 key poses, ADR-034 reference-video acceptance).
