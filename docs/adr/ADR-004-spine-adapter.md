# ADR-004 — Spine Adapter Boundary

Status: Accepted  
Date: 2026-09-23

## Context

Spine is the first output target, but Spine-specific structures inside the Core would prevent clean testing and future adapters.

## Decision

All Spine-specific parsing, compilation, defaults, and compatibility checks live in `packages/spine`. The first target is Spine 4.3. The adapter consumes AutoSpine IR and never becomes the Core data model.

## Alternatives

- Embed Spine fields in every Core package.
- Delay the adapter boundary until another target exists.

## Consequences

- Gate 1 requires an explicit translation layer.
- Spine format research stays localized.
- Future adapters remain possible without redesigning Core contracts.
