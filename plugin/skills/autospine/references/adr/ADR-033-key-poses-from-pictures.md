<!-- Generated from docs/adr/ADR-033-key-poses-from-pictures.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# ADR-033 — key poses from reference pictures

Context: in the 2026-10 batch blind test, one-shot motion was guessed from the animation name, and motion style failed (D1 5/45 one-shots). The ThreePigWC wolf's `Win` became a jump, while the artist made a tongue-out head tilt. With the answer seen, the engine reaches artist level (horse 12/12, GoldTree 11/11), so the missing input is the motion itself. A requester can usually give a few pictures of it: storyboard frames, or frames of a reference video.

`fit-pose` (ADR-024) fitted one picture to the rest pose on frame 0. A plan could key bones (`keyed`), but each bone channel takes one control, so a keyed head turn would replace the head's follow.

ADR-032 is taken by the motion priors (branch `claude/upbeat-hypatia-b931a5`).

Decision:

- **Plan**: `motion.animations[].keyposes: [{ frame, ease?, pose: { bone: { x?, y?, rotate? } } }]`.
  - It is a pose layer keyed on frames, in the units of `pose`: parent frame, y down, clockwise degrees.
  - The build adds it to every bone timeline after compiling the motion, like a `pose` that changes over time. Follows, waves, cycles and the main beats stay underneath.
  - Each key's `ease` (default `ease`) shapes the way into it.
  - A bone missing from a key has no offset there. Frame 0 has no offset unless a key sits there. A one-shot holds its last key; a loop returns to frame 0.
  - The lint checks planned bones, finite offsets, and frames that increase inside the animation.
  - The handover notes list the key frames and bones.
- **Adding tracks** (`addTracks` in `@autospine/motion`):
  - The sum is keyed at both tracks' key times.
  - A segment where one track holds still, or both move on the same curve, keeps that curve exactly. A linear track plus a curved one keeps the curve's handles, exactly.
  - Elsewhere one Bezier is fitted by least squares, within 0.1 degree or px of the sum on every frame. Where none fits, the segment is split at a frame and fitted again, down to one key per frame.
  - So keys stay sparse for the artist who takes over.
- **Fit** (`fitKeyPoses`; CLI `fit-pose <plan> <build> <frame>=<picture.png>... <out.json>`; MCP `autospine_fit_pose` with `references`):
  - Each picture is fitted like a rest pose on the build's pose at its frame: the same per-bone matching, fixed bones, translating bones and coverage. Its offsets therefore add to the motion already there.
  - A picture below `minCoverage` (default 0.6) gives no key pose. The summary lists each picture's coverage, residual and `unused` parts.
  - The output's `keyposes` replace the animation's block. They include the key poses the plan already had (the build was posed with them), so a second fit refines the first.
  - `zeroFrame` (`--zero`): that picture shows a pose the build already has, usually frame 0 after its rest pose was fitted from it. It gives no key pose. Its per-bone placements are the matching's own error on these drawings, such as a part the build bends differently. That error is removed from the other pictures' targets: target = D_f ∘ D_0⁻¹.
  - `ignore` (`--ignore`): parts not to match, such as an expression's mouth, eyes and tongue. It works for a rest pose too.
  - `ease` (`--ease`): the arrival ease written on the new keys.
  - The solve keeps every bone within `maxRotate` of where it was, as the part search already does. Without the bound, a hand the artist moved off its arm spun the forearm round by up to 90°.
- **Seam QA**: bone channels are sampled at the QA time with their key curves, as the runtime plays them. Before, they were stepped to the last key at or before it. Plan keys sat on the beats, so stepping was exact there; between sparse key poses it measured an earlier pose (the wolf: 6.4 px instead of 22.6).

Evidence:

- `tests/character-keyposes.test.ts`:
  - **Adding tracks**:
    - Exact while one track holds still, and for a line plus a curve.
    - Within 0.1 elsewhere, with one segment instead of a key per frame.
    - A step no curve can follow is split down to frames.
  - **Layering on the fixture**:
    - The head keeps its follow: on every frame its turn is the plan's turn plus the eased layer, within 0.1 degree.
    - The spine keeps exactly the key frames and their eases.
    - A one-shot holds its last key; seams stay under 11 px; the handover notes name the key frames.
  - **Lint**: an unknown bone, frames that do not increase, a frame past the end.
  - **Fitting**:
    - Three pictures are rendered from a build posed on frames 10, 30 and 50 (spine, arm and thigh turns over the fixture's motion) and fitted by the CLI over the unposed build.
    - Every posed bone comes back within 0.5 degree, and every other bone stays within 0.5 degree.
    - Rebuilt with the fitted key poses, the drawn vertices match the pictures' build: median below 0.5 px, every vertex within 2 px.
    - A second fit over that build keeps the other keys and refines its frame.
    - A frame past the end, or two pictures for one frame, are refused.
- `tests/character-files.test.ts`:
  - MCP `references` with `ease`.
  - Refused: both a rest-pose picture and key-pose pictures; a frame outside the animation (`MCP_FIT_FRAMES`).
- Fixture textures moved to `fixtureTextures()`, one noise per image: two equal legs side by side matched each other.
- **Two limits on the fixture**:
  - One image across two bones is matched as one rigid part, so a bent elbow comes back as a straight arm. Example: an arm turn of 12° with the forearm at 15° came back as 18.7° and 0.6°.
  - A head turn bends a body weighted from spine to head, and the head overshoots. Example: 5° came back as 6.5°, with the spine at −0.5°.
- **ThreePigWC wolf `Win`, in sample** (pictures rendered from the artist file, 524 × 800; local `docs/local-reviews/blind-tests/2026-10-14-batch/wolf3p/insample-keyposes`):
  - The base plan is the blind one-shot plan without the guessed jump. It keeps the breath, the head and arm follows, tail and ear waves, and the face parallax.

    | Build                                     | Total | B2      | D1    | D2    |
    | ----------------------------------------- | ----- | ------- | ----- | ----- |
    | Blind (name template: a jump)             | 10/11 | 9.4 px  | 6/16  | 0.629 |
    | Key poses, frames 8, 14, 44, 52, 60       | 10/11 | 26.0 px | 13/16 | 0.914 |
    | Key poses, plus frame 0 as zero           | 10/11 | 22.6 px | 11/16 | 0.914 |
    | The same, face parts ignored              | 9/11  | 25.2 px | 6/16  | 0.857 |
    | Zero, fitted a second time over its build | 8/11  | 19.0 px | 12/16 | 0.943 |

  - The body, head and tail now peak at 1.733 s, the artist's rebound on frame 52; the jump peaked at 0.7 s. Face parallax, pupil holds and key density (2.33, artist 2.07) pass too.
  - Frames 8 and 14 cover 0.592 and give no key pose.
  - The zero picture takes off the pants' error, a rigid misfit of about 9°: our pants mesh ends at x = 117 where the artist's reaches 170. The rest frame 60 then fits to almost nothing (median residual 0.13 → 0.01 px).
  - **Not captured**:
    - The tongue: the artist's three tongue bones turn 66° and scale 1.33; our tongue is a region without bones.
    - The expression deforms: face plate, eyes, nose, pupils.
    - The head tilt itself: when the expression changes, the head's 13 face parts out-vote its fur and ears, so the head is not placed on frames 8, 14 and 44. Ignoring them places it on frame 14, but the neck and head then turn hard against each other, and D1 drops to 6/16.
    - The artist's hand translations, and the scale keys.
  - **Hidden parts**: the chest's parts (body, shirt) are under the fur and hands and never match.
  - **Seam**: the right shoulder (`Cloth_01/Arm1_1`) drifts 22–26 px, because the torso leans while the hands stay.

Consequences:

- A requester can drive a one-shot with a few pictures instead of a name. The pictures carry the main pose changes; the plan keeps its breath, follows and waves.
- Key poses turn the plan's joints and move the hips and IK targets. Expressions, mesh deforms, scale, detached hands and hidden parts stay out, as for a rest pose. When the head's expression changes, ask for the expression as swaps or deforms; the pose fit will not place that head.
- Follows still follow the main beat, not the key poses: a head does not lag a fitted body rise. Feeding the main bone's key poses into the main control is a follow-up.
- A sum of two moving tracks is a fitted curve, within 0.1 degree or px, not the exact sum.
- Rollback: drop `keyposes`, `addTracks`, `fitKeyPoses` and the picture options. `fit-pose` returns to one picture and the seam QA to stepped channels.
