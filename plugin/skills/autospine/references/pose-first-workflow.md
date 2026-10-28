<!-- Generated from skills/autospine/references/pose-first-workflow.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# Pose-first animation: Layout → Blocking → Final

User requirement, 2026-10-28: key the important poses first, then progressively add detail keys. This is the motion production order, after the rig can reach its necessary poses. The skeleton's spatial layout is a separate rigging task.

## Before Layout

Read the brief and choose 2–3 relevant reviewed references where available. In this repository, use the current [animation library](animation-knowledge.md); in a standalone plugin, use the bundled [catalogue snapshot](animation-catalog.json). Prefer relevance to the character, medium, action and emotion over the fame of a studio. Keep US, European and Japanese influences separately identified; do not assume every production in a region shares a timing style. If no reviewed entry fits, use the brief and record that gap rather than forcing an irrelevant influence.

Record the reference IDs, exact observed frame/time/page, the useful principle, and the proposed adaptation. A production article supports a workflow claim; a sampled still supports pose/composition; continuous viewing is needed for rhythm/spacing claims. Trailer cuts are not inbetweens. Do not infer frame rate, exposure counts or numeric delays from isolated screenshots.

## 1. Layout: tell the action with important poses

- Define the action and emotional beats, duration, camera/crop, screen direction, contact points, and start/end or loop closure. Set frame rate explicitly for this project's own timeline.
- Key the start, anticipation, main extreme/contact and recovery poses that the action actually needs. Idle/breath actions also need their extreme poses; do not substitute a default wave for their pose design.
- Compose the torso, head, hands, feet and gaze together at each main beat. Check balance, line of action, silhouette, prop grip and the intended expression. A few well chosen keys should already explain the action.
- Review a pose contact sheet and a held-pose preview. Use `ease: "hold"` for arrivals in `keyposes` (the supported authoring value, not the invented value `"stepped"`); use linear only for a specific path check. Include explicit values at the shared main frames for the primary channels you intend to control, including zero offsets. Missing bone channels do not inherit an authored offset automatically.
- Keep decorative follow, waves, pulses and random blinks out. If a blink, cloth change or effect conveys a story beat, first design its key state as part of that beat. Do not add micro detail to hide a weak pose.

Pass when the important poses are readable at delivery size, the action/emotion and contact logic are clear, the framing works, and the start/end relation is intentional. Record any unresolved limitations. Do not proceed on a known failed primary pose.

## 2. Blocking: connect the poses deliberately

- Retain the Layout anchors. Add only the breakdowns needed to explain weight shift, turn, anticipation, contact/release and recovery. Set the timing, holds and leading/following order of the main controls.
- Review held/stepped playback first; also inspect a linear preview where paths or contacts require it. Check arcs, spacing intent, foot/hand slip, shape changes, attachment visibility and the loop seam. Do not globally smooth keys as a substitute for choosing breakdown poses.
- Keep secondary motion muted unless essential to the action. A dense `fit-video` result may supply candidate main poses, but it must be reduced to an explicit pose/breakdown pass for review before Final. It is not evidence that Layout and Blocking were completed.
- Check original anchor poses again. An intentional anchor/timing change gets an explanation and a revised checkpoint; it must not disappear silently during interpolation or fitting.

Pass when the main performance works with decorative tracks off, the contacts hold, and no unexplained pops, unintended reversals, intersections or silhouette losses remain in the intended visible view.

## 3. Final: refine the performance

- Refine curves, acceleration/deceleration, arcs and spacing while preserving the readable main beats. Then add overlap, follow-through, hair/cloth/ears, facial nuance, blinks and FX in that order as relevant to the brief.
- Compare the Final anchors against Blocking. Secondary tracks are additive and can change the main pose, so inspect both with and without them; fix drift rather than accepting a smoother but weaker performance.
- Inspect contacts, seams, collapsed meshes, layer order, image crop, loop/one-shot ending and supported editor/runtime playback. Apply key cleanup only with the existing error limits; protect important pose times where the chosen reduction mode supports locks. Do not trade away an anchor just to report fewer keys.
- Deliver the editable result, review video and handover with stage records, reference IDs and remaining issues. Engineering checks and visual self-review do not imply independent artist approval.

## Use the existing tools and save checkpoints

Use the normal versioned `_work/plans/plan-NN.json`, `_work/builds/build-NN/` and `_work/checks/` paths. Save stage records under `_work/notes/stages/<animation>/layout.json`, `blocking.json`, and `final.json`; use numbered record versions when revising. Each record names the plan version, build, pose sheet and preview paths, anchor frames and their intent, reference IDs/adaptation, review result (`pass`, `revise` or `blocked`) and any changed anchors. Do not insert these record fields into `CharacterPlan`, whose schema has no stage field.

`keyposes` add to the other motion blocks: early stage plans must explicitly neutralize the required `main` block (for example, a valid breath main with `depth: 0`) and omit/empty secondary `follow`, `waves`, `cycles`, `pulses` and decorative tracks. Check both top-level motion blocks and animation overrides. Keep necessary contact compensation and visibility keys. Use schema-valid plans, lint them and build each stage into a new directory. `fit-pose` can help position an anchor; its coverage and unfitted parts still need review.

This is an operator workflow built on the existing engine, not a new automatic artistic classifier or a hidden runtime gate. After a stage passes self-review, proceed to the next stage without asking for approval unless the user separately requests that review. A material brief or pose change returns to Layout/Blocking before more detail is added.
