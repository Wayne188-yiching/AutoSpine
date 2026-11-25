<!-- Generated from docs/adr/ADR-055-plugin-subagents.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# ADR-055 — plugin subagents and the Codex reviewer

Status: Accepted
Date: 2026-11-25 (plugin 0.5.26)

## Context

A character takes many engine steps. Several of them print long output that the main session needs only a summary of (the Spine export, lint and build logs, V1–V5 and A–D tables), and some need little judgment. Running everything in the main session fills its context and runs every step on the main session's model and effort, however simple the step.

Two rules in the skill were also only instructions: a failed comparison row is reported, not fixed by rebuilding (section 5), and the self-review at each pose-first stage should not just confirm the reviewer's own expectations.

The requester also uses OpenAI Codex. A second model family is a review that is not anchored on Claude's reasoning.

## Decision

- The plugin ships Claude Code subagents in `plugin/agents/`, each with a fixed model, effort where it matters, and tools:
  - `autospine-intake` (haiku, low effort; Bash, Read, Glob): engine version, `init-project`, Spine export, image copy, `strip-images`.
  - `autospine-reference-scout` (haiku; read-only plus Bash for `node -e` queries): reviewed entries of the animation library for an action, with the evidence type recorded for each.
  - `autospine-build-qa` (sonnet; Bash, Read, Grep, Glob, no Edit or Write): lint, build into the next folder, `compare-video`, `compare-reference`. It uses the bundled command line, never the MCP tools, so a stale MCP server after an update cannot answer with an older engine.
  - `autospine-visual-reviewer` (opus; Read, Glob, Bash for ffmpeg frames under `_work/checks/`): stage review from the files and the intent, without the main session's verdict.
  - `autospine-codex-reviewer` (haiku, low effort; Bash, Read): forwards one review to the local Codex CLI and returns its answer unchanged.
- `plugin/skills/autospine/delegate/codex-review.mjs` (hand-written; `tools/build-plugin.mjs` does not regenerate `delegate/`) runs `codex exec --sandbox read-only --ephemeral` with the prompt on stdin, optional `--model`, `--effort` (`model_reasoning_effort`) and `--image`, and prints Codex's last message. It finds Codex in `AUTOSPINE_CODEX`, then `codex` on PATH, then (Windows) the newest `codex.exe` the Codex desktop app keeps under `%LOCALAPPDATA%\OpenAI\Codex\bin\<build>\`. Exit 3 means no Codex; the reviewer then replies `CODEX_UNAVAILABLE`. Model and effort default to `AUTOSPINE_CODEX_MODEL` / `AUTOSPINE_CODEX_EFFORT`, then the user's Codex config; the plugin names no OpenAI model.
- The Codex reviewer is opt-in: only when the requester asks for a Codex review or enables it in their instructions, because it sends the brief and the named files to OpenAI. The plugin itself still sends nothing.
- `SKILL.md` section 1 says which step goes to which subagent, what stays in the main session, and that a subagent's report is checked against the files before it is reported. Hosts without plugin subagents (Codex, Cowork) run the steps as before.

## Consequences

- The no-rebuild rule for failed rows is enforced by the build subagent's tools, not only by wording. The main session can still edit plans.
- Codex's read-only sandbox covers the whole folder; Codex cannot be limited to "everything but the plans", so building stays with the Claude subagent.
- Subagents re-read references they need, so delegation saves the main session's context more than it saves cost; the skill keeps one- or two-command steps in the main session.
- Codex runs inside AutoSpine (the Codex host) do not read `plugin/agents/`; per-step models there are not set by the plugin.
- The subagent frontmatter follows Claude Code's agent format; a host that ignores `effort` uses its default.

## Evidence

- `tests/plugin-package.test.ts`: every agent file has a name matching its file, a description, a model and tools; `autospine-build-qa` and the reviewers have no Edit or Write; the skill names every agent. `findCodex` prefers `AUTOSPINE_CODEX`, then PATH, then the newest desktop-app build; `codexArgs` always passes the read-only sandbox and `--ephemeral`, and the effort only when given; bad efforts are refused.
- On a Windows machine with the Codex desktop app (codex-cli 0.166.0-alpha.6) and no `codex` on PATH: `--find` found the app's `codex.exe`; a one-word prompt answered in 8 s; `--model=gpt-6.1-terra --effort=low --image=Arm_R.png` described the example arm; asked to create a file, Codex answered that it was blocked and no file appeared; `AUTOSPINE_CODEX=/nope` gave exit 3.
