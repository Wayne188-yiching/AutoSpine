# AutoSpine project instructions

## Animation authoring

The user's production order is **Layout → Blocking → Final**. Key the important poses first, then add keys for progressively finer motion. This applies to new animation and substantial motion revisions, including idle loops. Rig joint sweeps are diagnostics, not a completed Layout.

Read `skills/autospine/references/pose-first-workflow.md` before authoring motion. Save and visually review each stage, retaining the plan, important pose frames, preview and review notes. Continue autonomously after the stage checks pass; this rule does not introduce a user approval gate. If the main action changes, revise the earlier stage before polishing it again. Do not use secondary oscillations or dense video fitting to bypass the pose pass.

Before Layout, consult `knowledge/animation/catalog.json` using `node tools/animation-knowledge.mjs search <terms>` and choose relevant reviewed references. Record the source IDs, actual observations and the planned adaptation. Metadata-only entries are a research queue. Preserve the difference between sampled poses, continuously watched motion and an inference about Spine implementation.

## Hourly reference curation

When this chat's scheduled curation runs, follow `knowledge/animation/CURATION.md`. Update only the reference library and its run logs; do not alter production assets, engine code or installed plugin caches as a side effect. Run `node tools/animation-knowledge.mjs check` and `node tools/animation-knowledge.mjs build` after changes. A saved library helps future retrieval; it is not model training or proof of improved artistic quality.

The user authorizes publishing each completed reference update to GitHub. After validation and the run log are saved, run `node tools/publish-animation-knowledge.mjs`. It commits only the allowlisted library files on top of remote `main`, without touching the working HEAD, staged files or production changes; GitHub Pages then deploys the site. Do not use `--bootstrap` during scheduled curation. Never force-push or mark a failed upload as successful; preserve local updates and notify on a publishing failure.
