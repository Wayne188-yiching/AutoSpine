# ADR-048 — motion drafts from the measured priors

Status: Accepted
Date: 2026-10-23 (plugin 0.5.14)

## Context

ADR-032 measured what artists do in idles, walks, prop loops and eight kinds of one-shot. It turned those numbers into `loopRecipe` and `oneShotTemplate` in `@autospine/motion`. Nothing called them:

- the skill told the agent to start from the priors, so each plan copied numbers out of a table by hand;
- the one-shot templates' `move` bone, alpha keys and swings had to be written as `keyed`, `colors` and `cycles` blocks each time.

The engine had ten kinds of motion but no way to ask for one. A comparison with other Spine AI tools (2026-10-23) listed a small motion library among AutoSpine's weak points.

## Decision

`motion-draft <plan.json> <new-plan.json> --animation=<name> [--kind=…] [--frames=n] [--subject=character|prop]` and `autospine_motion_draft` write one animation's draft into a NEW plan (`draftMotion` in `@autospine/character`, `draftMotionFiles` in the CLI).

**Kinds**:

- Loops: `idle`, `walk` and `prop`.
- One-shots: `entry`, `exit`, `jump`, `charge`, `press`, `levelup`, `look` and `transition`.
- Without `--kind`, the name decides: `idle` or `breath` gives an idle; `walk` a walk; a prop's `idle`, `loop` or `breath` a prop loop. Otherwise the ADR-032 one-shot keywords apply (In, Out, Win, Charge, Press, LevelUp, Look); any other name is a transition.
- `oneShotTemplate` takes an explicit `kind`.

**Subject**: a character when the plan has `qa.probes.face`, else a prop. The unit is the face probe's width on the images-only setup, or the prop's width.

**What the draft writes**: the animation's own `motion` (ADR-031) replaces whatever it had.

- A loop gets:
  - a `breath` main on the plan's main bone;
  - head translate follow (gain 0.7, lag 8) for an idle;
  - strand chains waved (`waves`, root ±8° for an idle);
  - upper arms swung (`cycles`). A walk swings the thighs opposite each other and each arm against its leg.
- The loop's cycle divides its frames.
- A one-shot gets:
  - a depth-0 main over the whole animation;
  - arm and strand swings from the template;
  - `keyed` translate, scale and rotate on a `move` bone;
  - head rotate keys for a look;
  - a `colors` alpha control over the parts the animation shows.
- A prop loop tilts the `move` bone ±2.25° once over the animation.
- `beats` are emptied, and an animation's `cycleScale` is dropped.

**The plan's other parts**:

- **`move` bone**: added when the plan has none. It sits at the feet (character) or centre (prop) of the parts the animation shows, under the root, and the root's other children move under it. The notes say so, since other plans of the character need the same bone before `merge-plans`.
- **Keys from an earlier draft**: the animation's keys come out of keyed controls on the same bone and channel and out of colour controls over its parts. Controls left empty go.
- **New animations**: a new animation copies `show` and `hide` from the idle (or the first animation with part sets, ADR-021). In a plan with pose sets side by side only one set then shows, and the pivot and alpha follow it.
- **Kept**: key poses, a rest pose and a mirror the animation already has stay and are named in the notes. They are the requester's and play over the draft.
- **Head bone**: `head`, else the first bone named like a head above the face probe's slot bone.
- **No arm bones, chains or head**: the draft says so.

The draft is linted before it is written, and its source paths are rewritten for the new file's folder. It is the priors' median, a starting point to build and watch, not the requester's motion.

## Evidence

- `tests/motion-draft.test.ts`:
  - The MCP tool is listed as writing, and in a fixture workspace writes `plans/win.json`: a 30-frame jump.
  - The fixture idle: breath depth `loopRecipe("idle")`, head follow, a Hair wave with `rootGain` 8°/depth, the arm at ±2°. Source paths are rewritten, `cycleScale` is dropped, and it builds.
  - `Win` on a plan with no `move` bone:
    - the bone is added under the root, and everything else hangs from it;
    - the translate keys equal `oneShotTemplate("Win")`;
    - the build keys `move`;
    - drafting again from the drafted plan (60 frames) keeps one `move` bone and two `move` controls, and notes the keys taken out;
    - an existing output is refused.
  - `In` after an idle that hides `Arm_R`: the entry hides it too, and its alpha leaves it out.
  - Caller-given figures:
    - a prop loop's `move` bone at the centre of the shown boxes, tilting ±2.25°;
    - a look with no head bone notes that and keys nothing; with `head` it keys the head;
    - a walk: 40 frames, cycle 20, the weak-prior note.
- **Bundled example** (`assets/example`): `IDLE`, `Win`, `In` and `Look` drafted, built and rendered:
  - the idle breathes;
  - `Win` dips, hops with a lean and lands, the arm and hair swinging;
  - `In` rises from half size at half alpha with a tilt and overshoot;
  - `Look` turns the head both ways.
- **Pig** (`AutoSpine_Rebuild_20261018`, plan-09: two pose sets side by side, sixteen chains, no `head` bone):
  - the head bone found was `front_head`;
  - `Win` and `Look` showed only the front set, as the idle does. Before part sets were copied, `Win` drew both pigs and pivoted between them.
  - The idle's six fitted key poses and rest pose were kept and named.
