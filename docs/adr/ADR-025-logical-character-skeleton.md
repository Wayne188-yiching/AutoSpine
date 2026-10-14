# ADR-025 — a logical character skeleton

Context: after ADR-024 the HorseYearFish in-sample build matched the artist's pose and wiring, but the user found the skeleton the main remaining problem. The point was not to copy the artist's 85 bones but to build the skeleton by a rule a reader can follow. The bones view showed:

- The legs had no bones. A gradient from the ground bone to the hips dragged the pants, and the shoes sat on the ground bone.
- The torso was one long spine bone from the pelvis to the collar.
- The two hat ribbons and coins (one image) had no bones.
- The leg sink (`sink.legs`) shortens each thigh along its own axis. On splayed legs that slides the feet inward (39 px on the horse's right foot).
- Seam QA counted overlap that another part covers. The horse's pant tops sit deep under the robe, and the check reported up to 50 px there while the visible hem was fine.

Decision:

- **Template** (skill and handbook). Every bone runs from its joint to the next one, so each chain is continuous:

  | Region                 | Bones                                                                                                                                  | Joints                                                                                  |
  | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
  | Ground                 | `base` at the ground point under the pelvis                                                                                            | `align(x: pelvis, y: feet)`                                                             |
  | Hips and torso         | `body` (the breath's main bone) at the pelvis, then `spine` (pelvis → chest) and `chest` (chest → neck base)                           | pelvis = between the leg tops; chest = halfway to the neck base                         |
  | Neck and head          | `neck` (neck base → neck top), `head` (neck top → crown)                                                                               | part overlaps                                                                           |
  | Legs                   | a vertical `stance` (ground → pelvis); on it, per leg, `thigh` (hip → knee) and `calf` (knee → ankle); `foot` (ankle → sole) on `base` | hip = `align(x: leg top, y: pelvis)`; knee = overlap of leg and sock; sole = lowest end |
  | Arms                   | from `chest`: shoulder → elbow → wrist → hand; hands resting on the body are pinned there by IK                                        | part overlaps and ends                                                                  |
  | Soft strands           | 3-bone chains from where they attach: hair, ears, moustache, beard, tail, mane                                                         | `chain.from` / `chain.near`                                                             |
  | Ornaments on one image | one 3-bone chain per ornament, from where it attaches to its far end, with `nearest` weights                                           | `end` of each side                                                                      |

- **Weights follow the bones**:
  - A robe or skirt over the legs takes a gradient from `base` to `spine`. The stance squashes the legs linearly between the same two heights, so robe and legs move alike.
  - Pants take chain weights on thigh and calf; sock and shoe a gradient from calf to foot. The neck takes a gradient from chest to head.
  - A torso that deforms is meshed denser than the artist median (65 points on the horse's robe, as the artist drew it).
- **Engine**:
  - Joint rule `align { x, y }`: the x of one joint and the y of another (a hip under its leg at the pelvis height).
  - `sink.squash.track: true` scales a bone so its tip follows the main's vertical offset (scale = 1 − y / vertical extent). It replaces `amount`. A vertical stance squashes the legs on it in step with the hips while the feet stay put.
  - Seam QA (B2) counts only the visible seam: the later-drawn part's hull vertices over the other part, and the other part's vertices within a band of that outline. The band is 4 % of the face image width, or 20 px without a face.
  - `fit-pose` keeps the rest pose logical:
    - The bones on the root stay fixed, because a rest pose does not move the ground. Without this, the horse fit lowered the ground bone 47 px and compensated in the legs and stance.
    - Only the main bone (the hips) and IK targets translate; every other joint only turns. On the wolf's blow loop, the fit had otherwise moved the thigh roots 90–141 px.
    - Chains, and bones the plan swings with `cycles` (tufts, ears), follow their parent, and their parts count toward it. A strand's bend on frame 0 is motion, not pose: fitting it zig-zagged the fixture's hair ±24° and turned the eagle's and moose's hair tufts 15–40°.
    - The result reports `coverage`: the share of sampled texels on parts whose match was used. Below about 0.6 the reference shows what a rest pose cannot, such as a scaled head or another expression, and the pose is not used.

Evidence:

- **`tests/character-skeleton.test.ts`** (3 tests):
  - `align` puts a joint at the thigh's x and the pelvis's y, and an unknown joint is reported.
  - A tracking stance's tip falls with the hips while its base stays, and `track` with `amount` is refused.
  - A lower part's interior sliding 30 px under the top part counts 30 px in the old measure and 0 on the visible seam.
- **HorseYearFish, in sample** (`docs/local-reviews/blind-tests/2026-10-14-horse-e2e/insample/plan-025.mjs`, rest pose fitted to the artist frame):
  - 66 bones, every one on a joint chain.
  - All six seams ≤ 7 px: robe/neck 0.1, robe/legs 7.0 and 1.3, pants/socks 4.4 and 3.6.
  - Feet planted: the ground bone, stance, legs and feet stay within 1 px and 0.5° in the fitted pose.
  - A6 0.009 / 0.059 head widths; C2 and C3 1.0.
  - D1 is 7/13 against 8/13 for the ADR-024 plan: the hand moves a little less against the body.
  - The review video's bones segment reads like the artist's: legs, centre line, arms, ribbons and strands.

Consequences:

- A planner can lay out a character from part names and overlaps without inventing a skeleton per character. The stance is a control bone, not anatomy, and shows as a line between the legs.
- B2 numbers before this ADR counted hidden overlap too; they are not directly comparable.
- The template is drawn from one character with a robe; a character with bare legs (knees visible) may need knee bends instead of a squash. The next blind tests will show.
- Rollback: drop `align`, `track` and the visible-seam band. B2 then counts all overlap again.
