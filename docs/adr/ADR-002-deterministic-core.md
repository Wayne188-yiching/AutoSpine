# ADR-002 — Deterministic Core

Status: Accepted  
Date: 2026-09-23

## Context

Rigging output cannot be reliably tested when geometry, weights, transforms, or serialization depend on unconstrained model generation.

## Decision

Core engines are deterministic and runnable without AI. The same input, spec, config, and seed must produce the same output.

## Alternatives

- Ask an LLM to generate complete target JSON.
- Permit uncontrolled randomness and visually inspect results.

## Consequences

- Algorithms and serialization require explicit tests and ordering rules.
- Random behavior must accept a seed.
- AI remains useful for planning and parameter selection, not numerical execution.
