import { readFile, writeFile } from "node:fs/promises";
import console from "node:console";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const reviewPath = process.argv[2];
if (!reviewPath || process.argv.length !== 3) {
  console.error("Usage: node tools/jev-gate-review.mjs <review.json>");
  process.exit(1);
}

try {
  process.env.TYPESAFE_LOG_LEVEL ??= "warn";
  const sdkRoot = process.env.JEV_TEST_ROOT ?? "D:/Wayne/JevTest";
  const sdkPath = resolve(sdkRoot, "node_modules/@typesafe-ai/sdk/dist/index.mjs");
  const { TypeSafeClient, choice, noul, score } = await import(pathToFileURL(sdkPath).href);
  const review = JSON.parse(await readFile(reviewPath, "utf8"));
  if (![1, 2, 3].includes(review.gate) || review.jevReview)
    throw new Error("Expected an unreviewed Gate 1, 2, or 3 bundle");
  const gate = review.gate;
  const gateScope =
    gate === 1
      ? "the minimal Gate 1 Spine 4.0.64 slice"
      : gate === 2
        ? "Gate 2 PNG Parts and clean 8-bit RGB raster PSD parsing, without AI rigging"
        : "Gate 3 tail alpha-to-MeshSpec topology, without rigging, weights, or Spine mesh output";
  const testScope =
    gate === 1
      ? "golden, runtime, CLI round-trip, and negative tests"
      : gate === 2
        ? "golden, parser, CLI smoke, negative, and prior-Gate regression tests"
        : "golden, independent topology mutation, private real-tail smoke, determinism, and prior-Gate regression tests";
  const architectureScope =
    gate === 1
      ? "Spine-specific logic stay in the adapter and CLI stay thin"
      : gate === 2
        ? "asset parsing stay in the assets package, with CLI thin and Core/Spine adapter unchanged"
        : "geometry stay in the mesh package, CLI stay thin, and prior packages remain engine-neutral";
  const state = { ...review };
  delete state.jevAttempts;
  const result = await new TypeSafeClient().systemOne({
    state,
    questions: {
      verdict: choice(
        `Should Gate ${gate} be accepted on the supplied evidence and stated narrow scope?`,
        {
          APPROVED: `All required Gate ${gate} criteria are credibly met.`,
          REJECTED: "An in-scope implementation or test deficiency needs correction.",
          BLOCKED: "External input or authorization is required to decide.",
        },
      ),
      scope_compliant: noul(`Is implementation limited to ${gateScope}?`),
      dod_satisfied: noul(`Are all Gate ${gate} definition-of-done items evidenced?`),
      tests_credible: noul(`Are ${testScope} credible?`),
      deterministic_evidence: noul(
        gate === 1
          ? "Does the 100-run exact serialization check support determinism?"
          : gate === 2
            ? "Do repeated exact serialization checks and explicit ordering rules support determinism?"
            : "Do 100-run exact output checks for synthetic and real-tail inputs support determinism?",
      ),
      regression_safe: noul(
        `Are prior Gate ${gate === 1 ? "0" : gate === 2 ? "0 and Gate 1" : "0, Gate 1, and Gate 2"} contracts and checks preserved?`,
      ),
      architecture_compliant: noul(`Does ${architectureScope}?`),
      evidence_quality: score("Rate the sufficiency and specificity of the evidence.", [
        "No usable evidence",
        "Weak evidence",
        "Partial evidence",
        "Good evidence",
        "Strong independent evidence",
      ]),
      primary_blocker: choice("What is the primary blocker, if any?", {
        NONE: "No blocker",
        SCOPE: "Out-of-scope work",
        CORRECTNESS: "Incorrect behavior",
        TESTS: "Insufficient tests",
        DETERMINISM: "Unstable output",
        REGRESSION: "Earlier Gate regression",
        ARCHITECTURE: "Boundary violation",
        EXTERNAL_INPUT: "External input required",
      }),
    },
  });
  const a = result.answers;
  const thresholds = {
    verdict: a.verdict.choice,
    verdictProbability: a.verdict.probabilities.APPROVED,
    scopeCompliant: a.scope_compliant.noul,
    dodSatisfied: a.dod_satisfied.noul,
    testsCredible: a.tests_credible.noul,
    deterministicEvidence: a.deterministic_evidence.noul,
    regressionSafe: a.regression_safe.noul,
    architectureCompliant: a.architecture_compliant.noul,
    evidenceQuality: a.evidence_quality.score,
    primaryBlocker: a.primary_blocker.choice,
  };
  const approved =
    thresholds.verdict === "APPROVED" &&
    thresholds.verdictProbability >= 0.8 &&
    thresholds.scopeCompliant >= 0.8 &&
    thresholds.dodSatisfied >= 0.8 &&
    thresholds.testsCredible >= 0.8 &&
    thresholds.deterministicEvidence >= 0.8 &&
    thresholds.regressionSafe >= 0.8 &&
    thresholds.architectureCompliant >= 0.8 &&
    thresholds.evidenceQuality >= 3.5 &&
    thresholds.primaryBlocker === "NONE";
  review.jevReview = {
    date: new Date().toISOString().slice(0, 10),
    model: result.model,
    decision: approved ? "APPROVED" : thresholds.verdict === "BLOCKED" ? "BLOCKED" : "REJECTED",
    thresholds,
    usage: { inputTokens: result.usage?.input_tokens, outputTokens: result.usage?.output_tokens },
    policyResult: approved
      ? "All mandatory approval thresholds passed."
      : "One or more mandatory approval thresholds failed.",
  };
  await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(review.jevReview));
  process.exitCode = approved ? 0 : review.jevReview.decision === "BLOCKED" ? 3 : 2;
} catch (error) {
  console.error(`${error?.name ?? "Error"}: ${error?.message ?? String(error)}`);
  process.exitCode = 4;
}
