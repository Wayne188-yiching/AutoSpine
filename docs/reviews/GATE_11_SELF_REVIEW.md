# Gate 11 — assistant engineering acceptance

Decision: **APPROVED_ENGINEERING**, 2026-10-05. Evidence: `GATE_11_SELF_CHECKS_2026-10-05.json`; format/lint/types, preview/official Runtime and Tail/Arm/Loop regressions passed.

Build output now includes manifest-bound self-contained preview and provenance: source PNG SHA256, semantic job SHA256 (source/output path names deliberately excluded for relocation determinism), and hashes of every delivered file except provenance itself. Existing output and dangling symlink targets are rejected via lstat; staged outputs remain recoverable. Rebuilding into another output path produces identical bundles.

Fixed-time UI uses `preview.html?time=0.5`. Actual isolated Chrome renders twice produced identical PNG SHA256 `1734a0dc87da0f5b1c94be73d22b8834b9f699e3caa1377235559281a28ea640`; directly viewed local screenshot shows textured fish, 21 vertices, 5 bones, 0.50s and matching manifest ID. Screenshot is local-only at `docs/local-reviews/gate-11-preview-03/frame-1.png`. Between baked sample times the browser linearly interpolates sampled vertices; it is an IR review, not an exact continuous official Runtime player.

Additional adapter integration: all ten presets exported to Spine 4.0 and compared at seven times (including a non-key time) with installed official spine-core 4.0.31. Bone translation flips y once; scale is multiplicative. Neutral rig/skinning supports these channels. Mesh deform export still explicitly rejects rather than silently dropping it. Source: [official JSON format](https://esotericsoftware.com/spine-json-format) plus installed version-specific SkeletonJson implementation. No paid calls or claims of editor GUI/artist approval.
