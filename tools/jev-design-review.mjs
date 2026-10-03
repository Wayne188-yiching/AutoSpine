// Explicitly requested design advice; never a Gate acceptance or runtime dependency.
import { readFile, writeFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import process from "node:process";
import console from "node:console";

const [input, output] = process.argv.slice(2);
if (!input || !output || process.argv.length !== 4)
  throw new Error("Usage: node tools/jev-design-review.mjs request.json new-result.json");
try {
  await access(output);
  throw new Error("Output already exists; preserve the previous decision");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (!process.env.TYPESAFE_API_KEY) throw new Error("TYPESAFE_API_KEY is not loaded");
const bytes = await readFile(input);
const request = JSON.parse(bytes.toString("utf8"));
if (request.state?.purpose !== "design-advisory-not-gate-approval")
  throw new Error("Expected an explicit design advisory request");
const response = await globalThis.fetch("https://api.typesafe.ai/v1/systemone", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(request),
  signal: globalThis.AbortSignal.timeout(120000),
});
if (!response.ok) throw new Error(`Jev HTTP ${response.status}; no decision recorded`);
const result = await response.json();
await writeFile(
  output,
  JSON.stringify(
    {
      purpose: request.state.purpose,
      requestSha256: createHash("sha256").update(bytes).digest("hex"),
      recordedAt: new Date().toISOString(),
      ...result,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(JSON.stringify({ model: result.model, answers: result.answers, usage: result.usage }));
