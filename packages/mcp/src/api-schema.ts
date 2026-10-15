/**
 * The JSON Schema advertised to MCP clients for a tool's input.
 *
 * TypeBox writes fixed-length tuples (`[x, y]` points, pose pairs) in the draft-07 form,
 * `items: [a, b]` with `additionalItems`. Clients that pass tool schemas on to the Anthropic API,
 * Claude Code among them, need JSON Schema 2020-12 and skip any tool with an array-valued `items`.
 * In 2020-12 the same tuple is `prefixItems: [a, b]` with `items: false`. Only the advertised copy
 * changes; the server still validates arguments with the original TypeBox schemas.
 */
export function advertisedSchema(schema: unknown): Record<string, unknown> {
  // JSON round trip drops TypeBox's symbol keys and gives an independent copy.
  return convert(JSON.parse(JSON.stringify(schema))) as Record<string, unknown>;
}

function convert(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(convert);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) out[key] = convert(value);
  if (Array.isArray(out.items)) {
    out.prefixItems = out.items;
    out.items = out.additionalItems === undefined ? false : out.additionalItems;
    delete out.additionalItems;
  }
  return out;
}
