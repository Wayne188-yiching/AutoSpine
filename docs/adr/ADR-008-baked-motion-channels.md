# ADR-008 — additive baked motion channels

Context: Gate 8 requires ten numeric presets; rotation-only cannot represent breathing, bounce or blink faithfully.

Decision: add optional bone translation/scale and mesh deform-offset timelines to AnimationSpec 0.1. Existing rotation-only specs and all eight registry entries remain unchanged. Translation is additive bone-local x/right y/down; scale is multiplicative relative to setup; deform arrays are mesh-space offsets, not absolute positions. Curves remain independent scalar functions; presets bake samples without embedding Spine fields. No Core dependency on models, tools or skill is introduced.

Alternatives: a separate duplicate animation IR would complicate validation; encoding all motion as rotation would be misleading. Migration is additive. Older minimal and weighted adapters must explicitly reject unsupported channels until their implementation is verified, rather than silently discard them. Tests cover strict validation, per-target uniqueness, finite ordered full-span keys, numerical motion and compatibility. Rollback: remove optional channels and new presets, retaining old wave output. Latest owner self-decision authority permits this nonbreaking extension; no artist-quality claim follows.
