/**
 * The plugin and engine version, as in plugin/.claude-plugin/plugin.json (tests/plugin-package
 * keeps them equal). The command line (`--version`), the MCP server (serverInfo and
 * autospine_get_status) and every build record report it, so a server left running from an
 * earlier plugin version can be told apart from the current command line.
 */
export const AUTOSPINE_VERSION = "0.5.10";
