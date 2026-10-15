<!-- Generated from docs/adr/ADR-005-cli-first.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# ADR-005 — CLI First

Status: Accepted  
Date: 2026-09-23

## Context

A large editor would consume effort before the automation engines are proven and would make deterministic builds harder to reproduce.

## Decision

The first executable product surface is a CLI. A CLI package is created when the first real command exists; Gate 0 does not add an empty or fake command. GUI work remains in the backlog until the Core vertical slices pass.

## Alternatives

- Build a desktop editor first.
- Expose only library APIs.
- Add a placeholder CLI in Gate 0.

## Consequences

- Early Gates optimize for scripts, CI, fixtures, and explicit files.
- There is no visual editing interface in the MVP.
- CLI behavior must remain a thin caller of engine packages.
