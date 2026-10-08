import process from "node:process";
import { AutoSpineMcpServer } from "./index.js";

// Legacy MCP stdio: UTF-8 JSON-RPC, exactly one line per message, no other stdout.
const server = new AutoSpineMcpServer(process.env.AUTOSPINE_WORKSPACE ?? process.cwd());
// Host-controlled allowance for explicit character IR. Keep the original default.
const configured = Number(process.env.AUTOSPINE_MCP_MAX_MESSAGE_MIB ?? 1);
const messageMiB =
  Number.isInteger(configured) && configured >= 1 && configured <= 16 ? configured : 1;
const limit = messageMiB * 1024 * 1024;
let pending = Buffer.alloc(0),
  discarding = false;
const send = (value: unknown) => process.stdout.write(JSON.stringify(value) + "\n");
for await (const chunk of process.stdin) {
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
  let offset = 0;
  while (offset < bytes.length) {
    const newline = bytes.indexOf(10, offset),
      end = newline < 0 ? bytes.length : newline;
    const piece = bytes.subarray(offset, end);
    if (!discarding && pending.length + piece.length > limit) {
      pending = Buffer.alloc(0);
      discarding = true;
      send({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: `Message exceeds ${messageMiB} MiB limit` },
      });
    }
    if (!discarding) pending = Buffer.concat([pending, piece]);
    if (newline >= 0) {
      if (!discarding && pending.length) {
        let input: unknown;
        try {
          input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(pending));
        } catch {
          send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
        }
        if (input !== undefined) {
          const response = await server.receive(input);
          if (response !== undefined) send(response);
        }
      }
      pending = Buffer.alloc(0);
      discarding = false;
    }
    offset = newline < 0 ? bytes.length : newline + 1;
  }
}
if (pending.length && !discarding)
  send({
    jsonrpc: "2.0",
    id: null,
    error: { code: -32700, message: "Messages must end with a newline" },
  });
