# ADR-003 — AI Boundary

Status: Accepted  
Date: 2026-09-23

## Context

AI is useful for semantic interpretation but unreliable as the authority for numerical geometry and target-format details.

## Decision

AI may classify assets, choose templates, propose bone counts, select animation presets and parameters, and analyze validation failures. AI output must be validated structured data before Core execution. AI does not calculate triangles, weights, transforms, interpolation, or serialization.

## Alternatives

- Remove AI entirely.
- Allow AI to generate final Spine JSON directly.

## Consequences

- The Core remains usable manually and in CI.
- AI failures stop at schema boundaries.
- Planner evaluation can evolve independently from engine correctness.
