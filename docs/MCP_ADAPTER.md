# AutoSpine MCP adapter

Gate 16 provides an actual local stdio server, not a placeholder or duplicated rig engine. It supports **legacy MCP v1** versions 2025-11-25 and 2025-06-18. Modern `server/discover` deliberately returns method-not-found for legacy client fallback; this is not a 2026 stateless protocol implementation.

Build first with `npm run build`. A host may launch:

```text
node C:/Wayne/Codex/AutoSpine/packages/mcp/dist/stdio.js
```

Set the host-controlled `AUTOSPINE_WORKSPACE` environment variable to the intended workspace, otherwise the server uses its working directory. This release does **not** register itself in Codex, modify client configuration, install globally, or launch a persistent background process.

| Tool                         | Effect                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `autospine_get_status`       | Read current engineering status and capability limitations                            |
| `autospine_validate_plan`    | Validate explicit proposal; disclose low-confidence review requirement                |
| `autospine_execute_plan`     | Compute and measure an approved-confidence plan in memory only                        |
| `autospine_build`            | Read a strict BuildJob and write its outputs into a **new** workspace-local directory |
| `autospine_review_metrics`   | Numeric defects to bounded CorrectionSpec; no visual AI call                          |
| `autospine_apply_correction` | Fingerprint-bound immutable in-memory rebuild, then remeasure                         |

Only `autospine_build` writes files. A client should obtain authorization for that mutation; annotations are advisory, not a permission grant. The adapter contains no upload, paid API, Git publication or credential tool. No private images are sent over a network.

The tool bridge currently builds the explicit **chain-wave** profile. The other engine APIs (humanoid template, presets and constraints) remain available as deterministic package functions; this adapter does not pretend to infer anatomy from an image or implement every Spine constraint mode.

## Scope and protocol checks

Job, PNG and new output must remain inside the configured workspace, using lexical and real-path checks including parent junction escapes. Job files are limited to 64 KiB. The existing CLI owns no-overwrite staging, PNG/resource validation, compilation and provenance. These guards are not a security sandbox for concurrently hostile filesystem changes. External asset directories are not silently whitelisted; use an explicitly authorized local working copy when needed, leaving originals intact.

UTF-8 JSON-RPC is newline-delimited, capped at 1 MiB per message, processed sequentially and stdout contains only protocol JSON. Initialization and `notifications/initialized` precede tools. Notifications cannot invoke mutation tools. Protocol errors and `isError` tool results are distinct; filesystem error details and raw private arguments are not echoed. The subprocess tests cover actual construction, existing-output rejection, recovery after malformed/oversized messages and junction escape rejection.

Engineering self-review is not live model evaluation, automatic artist approval or proof of a configured desktop client connection.

Primary protocol references: [legacy transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [legacy lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), [legacy tools](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-11-25/server/tools.mdx).
