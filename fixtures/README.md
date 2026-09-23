# Fixtures

Fixtures are introduced only by the Gate that owns their behavior. Gate 0 reserves the required vertical-slice categories without adding fake assets or expected outputs.

- `tail/` — Tail mesh, rig, weight, deformation, and animation fixtures
- `arm/` — Arm and elbow deformation fixtures
- `humanoid/` — Basic humanoid fixtures after Tail and Arm pass

Every future fixture must record its source, expected use, license status, and owning Gate.
