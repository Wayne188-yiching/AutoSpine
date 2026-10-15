---
name: autospine
description: Rig and animate a Spine 4.0 character or prop with the AutoSpine engine — bones, meshes, weights, IK, idle/loop or one-shot motion (entry, win, exit), a review video and handover notes — and compare it with the artist's version. Use when someone asks to 綁骨、做 Spine 動畫、做 idle／呼吸／進場／勝利動畫、自動建骨架網格權重, gives a .spine or Spine JSON with images to animate, or wants an automatic build checked against a hand-made .spine.
---

# AutoSpine

AutoSpine turns an images-only Spine file plus a short brief into an editable Spine 4.0 project: bones, meshes, weights, constraints and sparse keyframed motion, a review video and handover notes. You run the engine; the requester only gives the brief, watches the video and says what to change. Reply in the requester's language.

## 1. Find the engine

Use whichever is available, in this order:

1. **MCP tools named `autospine_*`** (Claude Code, Cowork on the requester's computer, Codex). Call `autospine_get_status` first: its `workspace` is the only folder the tools read and write (default `~/AutoSpine`). Put every input and output inside it.
2. **The bundled command line**, everywhere else or when a tool you need is missing:

   ```text
   node <skill>/scripts/autospine.mjs <command> ...
   ```

   `<skill>` is this skill's folder: `${CLAUDE_SKILL_DIR}` in Claude, otherwise the folder this SKILL.md was read from. It needs only Node.js 22.12 or later (`node --version`); there is nothing to install. The command line has no workspace limit, but the work-on-copies rule below still applies.

Run the engine where the files are. If you reach the requester's files only through a file bridge (a cloud session linked to their computer), copy the inputs into your own working folder, run there, and copy the outputs back to a new folder beside the inputs.

Check the install once when it is new or failing: copy `<skill>/assets/example/` to a new folder and run `lint-plan plan.json` then `build-character plan.json build`. It must print a summary with `"bones":20` and `"setupDeviationPx"` below 0.5.

The references and the user guide write commands as `node <skill>/scripts/autospine.mjs`; MCP tool names are given beside them in [the plan runbook](references/character-plan.md).

## 2. Take the brief

Ask only for what is missing, in one message:

- The Spine file: a `.spine` project, or its JSON export with the `images/` folder. Which skeleton if there are several.
- Each animation: name, length in seconds or frames, loop or one-shot (entry, exit, win).
- If the setup stacks several pose sets: which set this animation uses, and a picture of that pose.
- Hands: holding a prop, or resting on a table or forehead. How large props (trees, flags) should sway.
- Blinks (which frames), eye looks.
- **One-shots:** a few key-pose pictures (storyboard or reference-video frames) labelled with frame numbers, start and end included, e.g. `0, 8, 14, 44, 60`. A name alone only guesses the motion ("win" may become a jump). Expressions and mesh deforms are not fitted from pictures.
- An artist version to compare with, if one exists. Comparing is optional.
- Where to put the result.

Without a brief, the defaults are a light breath for characters and a small sway for props.

## 3. Work on copies

Never write into the original art folder or into a Spine project open with unsaved edits. Make a new job folder (inside the MCP workspace when using MCP), e.g. `<workspace>/<character>/<yyyy-mm-dd>/`, and copy the inputs there. Every build and comparison goes into a new output folder; the engine refuses existing ones.

A `.spine` project is exported to JSON with the Spine 4.0.64 command line (`Spine.com` on Windows, usually `C:\Program Files\Spine\Spine.com`; `/Applications/Spine.app/Contents/MacOS/Spine` on macOS):

```text
"<Spine.com>" -u 4.0.64 -i <project.spine> -o <job>/export -e <skill>/assets/spine-export-json.json
```

If Spine is not installed where you run, ask the requester to export JSON from Spine (File › Export, JSON, nonessential data on) and send it with its images.

## 4. Build

Follow [the plan runbook](references/character-plan.md); the short form:

1. `strip-images <artist.json> <images> <job>/imagesOnly.json` — keep placements only. Check `summary.over2px` is empty.
2. **Write the plan** (`plan.json` beside it). Start from a previous character's plan or `<skill>/assets/example/plan.json`. Part names are slot names (`slot#attachment` for non-setup attachments). Lay out the skeleton by the template in [the engine pipeline](references/engine-pipeline.md): every bone from its joint to the next, soft strands and ornaments as chains, mesh every shown part (`meshing: { all: true }`). Start motion from the measured priors there, not guesses; the brief and references override them.
3. `lint-plan plan.json` (`autospine_lint_character_plan`) until it reports no errors.
4. `build-character plan.json <job>/build-1` (`autospine_build_character`). Check `setupDeviationPx` ≤ 0.5 in `build-record.json`.
5. Pose pictures: `fit-pose plan.json <job>/build-1 pose.png pose.json` for a rest pose; `fit-pose plan.json <job>/build-1 0=f00.png 14=f14.png ... keyposes.json --animation=<name> --zero=0` for one-shot key poses (`autospine_fit_pose`). Put the result in the plan, build again into a new folder. Pictures with coverage below 0.6 are not used; say which.
6. `review-video plan.json <build> [artist.json] <job>/review.mp4` (`autospine_review_video`, needs ffmpeg). Always make it: wireframe, then bones, then plain motion; artist on the left when given.
7. With an artist version: `compare-reference plan.json <build> artist.json <job>/compare-1` (`autospine_compare_reference`). If D1/D2 fail, `optimize-motion plan.json artist.json <job>/opt --budget=150` (`autospine_optimize_motion`; exit 3 means run it again to resume), then build with `--params=<job>/opt/best-params.json`.
8. Several animations of one character: plan them apart if easier, then `merge-plans <job>/plan-all.json plan-a.json plan-b.json ...` (`autospine_merge_plans`) and build once, so the artist gets **one project per character**.
9. Optional editable project: `"<Spine.com>" -u 4.0.64 -i <build>/<name>.json -o <job>/<name>.spine -r`.

When a step fails, read its error code and fix the plan; the [pitfalls list](references/character-plan.md#pitfalls-seen-so-far) covers the common ones. Do not edit the engine's output JSON by hand.

## 5. Hand over

Give the requester, with paths:

- The Spine JSON and its `images/` (Spine › Import Data), or the `.spine` project.
- `review.mp4`, and say what to look at.
- `HANDOVER.md`: bones by role (blue main, red control, orange face followers, green chains), constraints, what each animation keys, where to edit.
- With an artist version, the A–D results as PASS/FAIL lines (A placement and loops, B mesh folds and seams, C parts that should move, D timing and size against the artist). All PASS only means the numbers are close; the video decides. Results tuned against the artist are **benchmark-tuned**, not blind.

Then ask what to change. Feedback such as "the cane should follow the hand" or "sway the tree more" goes into the plan; rebuild into a new folder and send a new video. Hand edits in Spine are not written back to the plan, so the last 5–10 % of polishing is done in Spine after the plan is final.

## 6. Limits

- Expressions (a smile to a closed mouth) are not generated; colours are not checked automatically.
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
- `references/adr/` — why each engine rule exists (ADR-017 plans, ADR-024 rest pose, ADR-031 one project per character, ADR-033 key poses).
