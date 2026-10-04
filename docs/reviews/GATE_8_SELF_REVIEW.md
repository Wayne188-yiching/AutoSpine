# Gate 8 — assistant engineering acceptance

Decision: **APPROVED_ENGINEERING**, 2026-10-05. Evidence: `GATE_8_SELF_CHECKS_2026-10-05_03.json`; ten presets are numeric baked keys, not metadata stubs. Each is schema-checked and rebuilt identically 100 times; blink responds to seed and squash/stretch maintains x*y=1. Unknown presets, invalid parameters and foreign timeline targets are rejected. Existing weighted Runtime and legacy adapter regressions included.

Channels: wave/sway/follow-through/overshoot/rotation; bounce/float translation; breathe/blink/squash-stretch scale. Blink uses a minimum positive scale, not eye-attachment switching. Overshoot is explicitly non-looping. No real facial/performance acceptance. Optional baked translation/scale/deform schemas are additive, retaining eight registry entries (ADR-008).

Boundary audit found a silent-drop risk in adapters after schema extension: both now explicitly reject additional channels pending their verified mapping. Thus preset engine acceptance does not imply all presets can already export; Gate 11 will cover that integration. Original wave output remains compatible. Earlier evidence includes a nonexistent legacy test filter; the checker now requires each input test file to exist and the final run uses `spine-compiler.test.ts`. The first report and failed formatter check are preserved, not counted as final acceptance.
