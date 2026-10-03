// Gate 4 only. Requires explicit approval for the prepared request and paid submission.
import { readFile, writeFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import console from "node:console";

export function evaluateGate4Review(result) {
  const a = result.answers ?? {};
  const thresholds = {
    verdict: a.verdict?.choice ?? null,
    verdictProbability: a.verdict?.probabilities?.APPROVED ?? null,
    scopeCompliant: a.scope_compliant?.noul ?? null,
    dodSatisfied: a.dod_satisfied?.noul ?? null,
    testsCredible: a.tests_credible?.noul ?? null,
    deterministicEvidence: a.deterministic_evidence?.noul ?? null,
    regressionSafe: a.regression_safe?.noul ?? null,
    architectureCompliant: a.architecture_compliant?.noul ?? null,
    evidenceQuality: a.evidence_quality?.score ?? null,
    primaryBlocker: a.primary_blocker?.choice ?? null,
  };
  const probabilities = [
    thresholds.verdictProbability,
    thresholds.scopeCompliant,
    thresholds.dodSatisfied,
    thresholds.testsCredible,
    thresholds.deterministicEvidence,
    thresholds.regressionSafe,
    thresholds.architectureCompliant,
  ];
  const approved =
    thresholds.verdict === "APPROVED" &&
    probabilities.every((value) => Number.isFinite(value) && value >= 0.8 && value <= 1) &&
    Number.isFinite(thresholds.evidenceQuality) &&
    thresholds.evidenceQuality >= 3.5 &&
    thresholds.evidenceQuality <= 4 &&
    thresholds.primaryBlocker === "NONE";
  return {
    decision: approved ? "APPROVED" : thresholds.verdict === "BLOCKED" ? "BLOCKED" : "REJECTED",
    thresholds,
    policyResult: approved
      ? "All unchanged mandatory Gate approval thresholds passed."
      : "One or more mandatory approval thresholds failed or were missing.",
  };
}

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || process.argv.length !== 4)
    throw new Error(
      "Usage: node tools/jev-gate4-precision-review.mjs request.json new-result.json",
    );
  try {
    await access(output);
    throw new Error("Output already exists; preserve the previous review");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const bytes = await readFile(input);
  const request = JSON.parse(bytes.toString("utf8"));
  if (
    request.model !== "jev-latest" ||
    request.state?.purpose !== "gate-4-precision-acceptance" ||
    request.state?.gate !== 4 ||
    request.state?.localVerification?.status !== "PASSED"
  )
    throw new Error("Expected a locally verified Gate 4 precision acceptance request");
  const sourceHash = createHash("sha256")
    .update(await readFile("packages/rig/src/index.ts"))
    .digest("hex");
  if (sourceHash !== request.state.engineSourceSha256)
    throw new Error(
      "Rig source changed since the review was prepared; do not submit stale evidence",
    );
  if (!process.env.TYPESAFE_API_KEY) throw new Error("TYPESAFE_API_KEY is not loaded");
  const response = await globalThis.fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: bytes,
    signal: globalThis.AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`Jev HTTP ${response.status}; no acceptance recorded`);
  const result = await response.json();
  const judgment = evaluateGate4Review(result);
  const record = {
    purpose: request.state.purpose,
    gate: 4,
    requestSha256: createHash("sha256").update(bytes).digest("hex"),
    recordedAt: new Date().toISOString(),
    model: result.model,
    answers: result.answers,
    usage: result.usage,
    ...judgment,
  };
  await writeFile(output, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ model: result.model, usage: result.usage, ...judgment }));
  process.exitCode = judgment.decision === "APPROVED" ? 0 : judgment.decision === "BLOCKED" ? 3 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main().catch((error) => {
    console.error(error.message);
    process.exitCode = 4;
  });
