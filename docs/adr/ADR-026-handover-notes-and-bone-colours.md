# ADR-026 — handover notes and bone colours

Context: the user asked whether people can take an AutoSpine file over and keep optimising it. A check of a blind build (ThreePigWC wolf `02_Idle`) found these parts already easy to edit:

- Sparse keys (2–4 per timeline over 70 frames) with Bézier curves, nothing baked.
- English joint names along the body (`spine`, `chest`, `thigh_l`).
- Standard IK and Transform constraints, 2–4 weights per vertex, meshes at artist density.

Two things were hard to find without reading the plan:

- **Control bones.** The file mixes deforming joints with bones that carry no image and only drive others: the face rig, the aligned `*_frame` carriers, IK targets and the leg stance. It also has face-follower Transform constraints. In the editor they all look alike.
- **The rest pose.** It lives in keys (ADR-024), not in the setup pose. Without a note, an animator looks for the pose in the wrong place.

Decision:

- **Bone colours by role**, set in the Spine JSON so the editor tree and viewport show them:
  - main bone: blue;
  - control bones (face base/control/counter, IK targets and squash bones that carry no image): red;
  - face followers, layers and their carriers: orange;
  - strand chains: green;
  - joints: the editor default.

  An IK target that carries images, such as a planted foot, stays a joint.

- **`HANDOVER.md`** is written next to every build, in plain language:
  - the bone table by role with what each kind is for, and the centre line;
  - every IK and Transform constraint and which number to change;
  - meshes and their weight types;
  - per animation: the rest-pose bones, the part set, what the main, follow, face, squash, wave, cycle and keyed blocks put keys on, and how many bones have keys;
  - common edits in the editor;
  - that hand edits do not flow back into the plan.

Evidence:

- `tests/character-handover.test.ts`: roles, colours in the document, and notes that name the constraints, the face control and each animation.
- The wolf build's notes list 47 bones by role, 2 IK and 6 Transform constraints, 10 planned meshes plus 25 automatic ones, and the 21 rest-pose bones of `02_Idle`.

Consequences:

- An animator sees the controls at a glance and has a one-page map of what the generator did.
- Rollback: drop the colours and the notes file. The Spine document is otherwise unchanged.
