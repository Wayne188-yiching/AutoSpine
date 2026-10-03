import { readFile, writeFile } from "node:fs/promises";
import console from "node:console";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { checkGate32ArtistCounts } from "./artist-vertex-policy.mjs";
import { checkGate32TopologySummary } from "./artist-topology-policy.mjs";
import { checkArtistCorpus } from "./artist-corpus-policy.mjs";
import { createHash } from "node:crypto";

const reviewPath = process.argv[2];
if (!reviewPath || process.argv.length !== 3) {
  console.error("Usage: node tools/jev-gate-review.mjs <review.json>");
  process.exit(1);
}

try {
  const review = JSON.parse(await readFile(reviewPath, "utf8"));
  if (![1, 2, 3, 3.1, 3.2, 4].includes(review.gate) || review.jevReview)
    throw new Error("Expected an unreviewed Gate 1, 2, 3, 3.1, 3.2, or 4 bundle");
  const gate = review.gate;
  if (gate === 3.2) {
    if (review.referenceReportPath) {
      const bytes = await readFile(resolve(review.referenceReportPath));
      if (createHash("sha256").update(bytes).digest("hex") !== review.referenceReportSha256)
        throw new Error("Reference report hash mismatch; rebuild the review bundle");
      const report = JSON.parse(bytes.toString("utf8"));
      review.artistVertexPrecheck = checkArtistCorpus(report);
      // Structured local observations only. Never upload source projects, PNGs or videos.
      review.referenceEvidence = {
        mediaAccess:
          "Jev receives derived metrics and frame observations, not direct access to private media",
        projects: report.projects,
        attachments: report.cases
          .filter((c) => c.sourceType === "mesh")
          .map((c) => ({
            id: c.id,
            pngSha256: c.pngSha256,
            count: c.count,
            positions: c.positions?.groups,
            edges: c.typedEdges,
            coverage: c.coverage,
            referenceRegion: c.referenceRegion,
            error: c.error,
            deterministicRuns: c.deterministicRuns,
          })),
        tutorialObservations: (report.tutorialEvidence ?? []).map(
          ({ videoSha256, frameSha256, timeSeconds, observation, scope }) => ({
            videoSha256,
            frameSha256,
            timeSeconds,
            observation,
            scope,
          }),
        ),
        limitations: [
          "UV-space only; not posed deformation approval",
          "Typed hull/manual recall100% and automatic recall80%; same-type subdivision within1px; not official editor round-trip approval",
          "Position policy chosen in the 2026-09-30 Jev design advisory; that advisory is not Gate acceptance",
        ],
      };
    } else {
      const counts = checkGate32ArtistCounts(review);
      review.artistVertexPrecheck =
        counts.status === "PASSED"
          ? {
              status: "BLOCKED",
              reason:
                "Gate 3.2 now requires the Yuuna/panda/pig corpus evidence, positions and edge classification",
            }
          : counts;
    }
    if (review.artistVertexPrecheck.status !== "PASSED") {
      await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`, "utf8");
      console.log(
        JSON.stringify({
          source: "local-hard-rule",
          jevCalled: false,
          ...review.artistVertexPrecheck,
        }),
      );
      process.exit(review.artistVertexPrecheck.status === "BLOCKED" ? 3 : 2);
    }
    review.artistTopologyPrecheck = review.referenceReportPath
      ? {
          status: review.artistVertexPrecheck.status,
          source: "full primary artist corpus precheck",
          checkedMeshes: review.artistVertexPrecheck.checkedMeshes,
          failures: review.artistVertexPrecheck.failures,
        }
      : checkGate32TopologySummary(review);
    if (review.artistTopologyPrecheck.status !== "PASSED") {
      await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`, "utf8");
      console.log(
        JSON.stringify({
          source: "local-hard-rule",
          jevCalled: false,
          ...review.artistTopologyPrecheck,
        }),
      );
      process.exit(review.artistTopologyPrecheck.status === "BLOCKED" ? 3 : 2);
    }
  }
  process.env.TYPESAFE_LOG_LEVEL ??= "warn";
  const sdkRoot = process.env.JEV_TEST_ROOT ?? "D:/Wayne/JevTest";
  const sdkPath = resolve(sdkRoot, "node_modules/@typesafe-ai/sdk/dist/index.mjs");
  const { TypeSafeClient, choice, noul, score } = await import(pathToFileURL(sdkPath).href);
  const gateScope =
    gate === 4
      ? "Gate 4 deterministic straight ChainRigTemplate from explicit start/end/boneCount into engine-neutral RigSpec, without inferred joints, attachment binding, weights, deformation, or Spine serialization"
      : gate === 3.2
        ? "Gate 3.2 Yuuna/panda/pig reference-conditioned static mesh calibration: artist-used foreground selection is disclosed, missed effective foreground <=2%, transparent padding <=same artist reference, excluded source content must not be reintroduced; absolute +/-5 vertices, per-group one-to-one positions and explicit manual versus automatic edges; tutorials support review only; no independent semantic segmentation, new bones, weights or deformation approval"
        : gate === 1
          ? "the minimal Gate 1 Spine 4.0.64 slice"
          : gate === 2
            ? "Gate 2 PNG Parts and clean 8-bit RGB raster PSD parsing, without AI rigging"
            : gate === 3.1
              ? "Gate 3.1 low-vertex tail topology guided by the user's 23-vertex Spine screenshot, without bones, weights, or deformation claims"
              : "Gate 3 tail alpha-to-MeshSpec topology, without rigging, weights, or Spine mesh output";
  const testScope =
    gate === 4
      ? "schema checks, independent parent-local forward-kinematics assertions for horizontal/vertical/diagonal/reversed chains, exact 100-run serialization, structured invalid-input errors, CLI safety, and the full prior-Gate regression suite"
      : gate === 3.2
        ? "all required Yuuna/panda/pig attachment metrics, source hashes, timestamped tutorial observations, manual/automatic line separation, portable negative tests, Tail regression and 100-run determinism"
        : gate === 1
          ? "golden, runtime, CLI round-trip, and negative tests"
          : gate === 2
            ? "golden, parser, CLI smoke, negative, and prior-Gate regression tests"
            : gate === 3.1
              ? "portable curved-art coverage and 32-vertex cap regression, independent topology checks, private 24-vertex Tail.png metrics, 100-run determinism, and prior-Gate regression tests"
              : "golden, independent topology mutation, private real-tail smoke, determinism, and prior-Gate regression tests";
  const architectureScope =
    gate === 4
      ? "chain geometry stay in a deterministic rig package depending only on schemas, CLI stay thin, and all earlier engine/IR boundaries remain unchanged"
      : gate === 3.2
        ? "deterministic geometry stay in Mesh, optional engine-neutral manualEdges additive to MeshSpec, private reference tooling stay dev-only, CLI stay thin, and other engines stay unchanged"
        : gate === 1
          ? "Spine-specific logic stay in the adapter and CLI stay thin"
          : gate === 2
            ? "asset parsing stay in the assets package, with CLI thin and Core/Spine adapter unchanged"
            : gate === 3.1
              ? "the refinement stay in the deterministic mesh package, preserve the MeshSpec contract, and leave other engines unchanged"
              : "geometry stay in the mesh package, CLI stay thin, and prior packages remain engine-neutral";
  const state = { ...review };
  delete state.jevAttempts;
  delete state.referenceReportPath;
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
      ...(gate === 3.2
        ? {
            artist_topology_supported: noul(
              "Does evidence compare every required Yuuna/panda/pig attachment to the SAME original artist source with absolute vertex count difference <=5, one-to-one hull/interior position errors, and manual solid edges separated from automatic dashed triangulation? Are tutorial observations timestamped, and media access limits disclosed? Counts alone or copied expected coordinates do not establish a general mesh generator.",
            ),
          }
        : {}),
      tests_credible: noul(`Are ${testScope} credible?`),
      deterministic_evidence: noul(
        gate === 4
          ? "Do 100-run byte-identical chain RigSpec checks, plus fixed-order math and no random/external state, credibly support determinism?"
          : gate === 3.2
            ? "Do 100-run byte-identical checks of every required primary reference mesh and portable prior-Gate regression checks credibly support determinism?"
            : gate === 1
              ? "Does the 100-run exact serialization check support determinism?"
              : gate === 2
                ? "Do repeated exact serialization checks and explicit ordering rules support determinism?"
                : "Do 100-run exact output checks for synthetic and real-tail inputs support determinism?",
      ),
      regression_safe: noul(
        `Are prior Gate ${gate === 4 ? "0 through 3.2 (including the matched artist topology and vertex-budget tests)" : gate === 3.2 ? "0 through 3.1 (including the explicit tail-chain regression)" : gate === 1 ? "0" : gate === 2 ? "0 and Gate 1" : gate === 3.1 ? "0, Gate 1, Gate 2, and Gate 3" : "0, Gate 1, and Gate 2"} contracts and checks preserved?`,
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
    ...(gate === 3.2 ? { artistTopologySupported: a.artist_topology_supported.noul } : {}),
  };
  const approved =
    (gate !== 3.2 ||
      (review.artistVertexPrecheck.status === "PASSED" &&
        review.artistTopologyPrecheck.status === "PASSED" &&
        thresholds.artistTopologySupported >= 0.8)) &&
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
