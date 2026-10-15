<!-- Generated from docs/adr/ADR-021-per-animation-part-sets.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# ADR-021 — per-animation part sets in character plans

Context: the gingerbread blind test (2026-10-14, `docs/local-reviews/gingerbread-e2e-blindtest-2026-10-14/`) chose the artist's only breathing idle, `Awake_Breathe_Loop`.

- **What the animation shows.** It hides every part of the setup pose (29 `Idle_*` slots and `Magic_Scale`) and shows another pose set that is hidden in setup: 16 `Drop_*` slots and `light_star`. This is how game artists often keep several poses of one character in one skeleton.
- **What the plan could not do.** `CharacterPlan-0.1` could not:
  - switch attachments per animation;
  - place joints, bones, meshes or the face dome on a setup-hidden slot by its slot name: such a slot has only `slot#attachment` parts, and its region key was even rejected by lint;
  - measure the performance unit (head width) on a hidden head.
- **The result.** The frozen round-1 build animated the setup set, so motion recall and precision were 0, and the critic had no shared probe (5/11 for both the blind plan and its control).
- **The tools failed too.** Lint rejected region keys of hidden slots. `compare-reference` crashed when the artist never showed a probe part.

Decision:

- **`motion.animations[].show` / `hide`.**
  - `show` names a slot, which shows its setup attachment, else its only attachment, or `slot#attachment`. `hide` names slots.
  - Each entry becomes an attachment key held for the whole animation (keys at 0 and at the duration).
  - Animations without lists keep the setup pose's attachments.
  - The keys are compiled in `compileCharacter` from the plan, so every call site (CLI, optimizer, MCP) gets them.
  - Errors (`PLAN_PART_SET`, and lint): an unknown slot, a slot listed twice, and a shown slot with several attachments and no `#attachment`.
- **Hidden parts by slot name.**
  - Joint rules, meshes, the face head and probes may name a slot hidden in setup when it has exactly one attachment; it resolves to its `slot#attachment` part (`PartIndex.part`, lint).
  - Regions stay keyed by slot, and lint now checks them against slot names.
- **Measurement.**
  - `headUnit` measures a head hidden in setup on its own attachment.
  - `performanceSample` drops a probe that is never shown in the measured animation. Its metrics are missing rather than a crash, and the chain or hand options are used only when all their probes are present.
- **Protocol** for future blind tests:
  - The brief may state which slots each animation shows: attachment on/off only, read from the artist's attachment state with no colour, transform or timing.
  - This is information a client gives an animator, and images and names alone cannot reveal it.

Evidence:

- **`tests/character-partsets.test.ts`** (3 tests), on the official runtime:
  - A fixture slot hidden in setup is rigged by its slot name. It is shown only in its animation (setup still shows the arm, the animation hides it), sits where the images-only layout put it, and swings on its own bone.
  - `headUnit` measures it at its width.
  - Ambiguous, unknown and repeated entries are rejected, and `slot#attachment` picks one of two attachments.
- **`tests/character-plan.test.ts`**: regions are keyed by slot, including hidden slots.
- **`tests/character-reference.test.ts`**: a probe the artist hides for a whole animation drops its chain and hand metrics instead of failing.
- **Gingerbread round 2** (`PROTOCOL-2.md`, frozen before any artist transform or timing was read):
  - The Drop set was rigged from the images-only layout, shown with `show`/`hide`, and the build ran end to end.
  - Automated acceptance went from 5/11 to 9/11: motion recall 0.875, precision 1.0 and seam drift 9.19 px pass (B1 0), and D2 is 1.0.
  - C2, C3 and B3 were known from round 1 and do not count as blind. D1 3/10 against the control's 4/10, so the ADR-019 defaults still miss (face slide, parallax holds, hand range; see `RESULTS-2.md`).

Follow-up (in sample, 2026-10-14):

- **The cane.** Round 2 had pinned the left hand and left the cane on the ground. The artist moves the hand and the cane with the body: −22.2 px against the collar's −22.5 px, turning only 1.6°.
- **The rule.** A prop the character holds rides on the hand bone, and only a hand resting on scenery is pinned.
- **Result.** Applied in sample (`plan2b`), motion recall went from 0.875 to 1.0, with D2 at 1.0 and B2 at 9.19 px; D1 is unchanged at 3/10.

Consequences: characters that keep several poses in one skeleton can be planned per animation. A blind brief now includes each animation's part set. Changing attachments within an animation (blinks, mouth shapes) is still not expressible. Rollback: drop `show`/`hide` and the slot-name fallback; plans must then use `slot#attachment` keys and setup parts only.
