# Gate 1 Plan — Minimal Spine 4.3 Compiler

Status: Planned only; no compiler implementation exists in Gate 0.

## Goal

Compile a minimal AutoSpine IR document into Spine 4.3-compatible JSON containing one root bone, one child bone, one slot, one default skin, one region attachment, and one simple animation.

## Proposed files

```text
packages/spine/src/compiler/
packages/spine/src/schema/
packages/spine/src/validator/
fixtures/spine/minimal/
tests/spine-compiler.test.ts
docs/research/SPINE_FORMAT_RESEARCH.md
```

Exact filenames may change during Gate 1 planning if official evidence suggests a smaller structure.

## Interfaces

Gate 1 should introduce the smallest explicit boundary resembling:

```text
compileSpine43(input: BuildInput): SpineJsonDocument
validateSpine43(document: unknown): ValidationReport
```

The concrete `BuildInput` and output type must be based on the approved IR and verified Spine 4.3 format. No compiler signature is added during Gate 0.

## Research before implementation

1. Create a legal minimal project in the exact target Spine 4.3 patch.
2. Export JSON and atlas data from the editor.
3. Compare the export with official JSON documentation and the matching official runtime.
4. Confirm import and information commands with the Spine CLI.
5. Record Known, Assumption, Experimental, and Verified findings in `docs/research/SPINE_FORMAT_RESEARCH.md`.

## Tests

- Schema tests for the minimal supported output.
- Golden test against a real Spine 4.3 export.
- Parent-first bone ordering.
- Slot-to-bone and attachment references.
- Setup-pose transform preservation.
- Stable property and array ordering.
- Compile the same IR 100 times and compare exact serialized output.
- Reject invalid references with structured validation issues.
- Spine CLI import and info round trip when the licensed CLI is available.

## Risks

- Implementing from memory instead of an exact 4.3 export.
- Differences between editor patch and runtime versions.
- Incorrect coordinate, rotation, omission, or default-value conventions.
- Treating Spine JSON as Core IR.
- Golden fixtures that were hand-authored rather than exported and verified.

## Spine compatibility questions

- Which exact Spine 4.3 patch and runtime snapshot define the target?
- Which fields are required, optional, or omitted when holding defaults?
- What coordinate origin, axis direction, angle unit, and transform inheritance rules apply?
- What skin representation does the selected 4.3 export use?
- What minimum atlas and image metadata are required for CLI verification?
- How should compatibility metadata and version failures be reported?

## Definition of Done

- Research distinguishes verified facts from assumptions.
- Minimal IR compiles without AI.
- The output passes internal validation.
- One real 4.3 golden fixture matches the supported semantics.
- One hundred runs produce byte-identical output.
- The matching official runtime can load the output.
- The Spine CLI round trip passes, or an explicit external-tool blocker is recorded.
- Jev approves the Gate 1 review bundle.

## Stop condition

Gate 1 ends after the minimal compiler is accepted. Asset parsing, Mesh, Weight, AI, MCP, Skill, Preview, and GUI remain out of scope.
