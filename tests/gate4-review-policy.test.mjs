import { describe, expect, it } from "vitest";
import { evaluateGate4Review } from "../tools/jev-gate4-precision-review.mjs";

function passing() {
  return {
    answers: {
      verdict: { choice: "APPROVED", probabilities: { APPROVED: 0.8 } },
      scope_compliant: { noul: 0.8 },
      dod_satisfied: { noul: 0.8 },
      tests_credible: { noul: 0.8 },
      deterministic_evidence: { noul: 0.8 },
      regression_safe: { noul: 0.8 },
      architecture_compliant: { noul: 0.8 },
      evidence_quality: { score: 3.5 },
      primary_blocker: { choice: "NONE" },
    },
  };
}

describe("Gate 4 precision review preserves mandatory approval thresholds", () => {
  it("accepts only when every unchanged threshold is met", () => {
    expect(evaluateGate4Review(passing()).decision).toBe("APPROVED");
  });
  it.each([
    "scope_compliant",
    "dod_satisfied",
    "tests_credible",
    "deterministic_evidence",
    "regression_safe",
    "architecture_compliant",
  ])("rejects a failed %s", (key) => {
    const response = passing();
    response.answers[key].noul = 0.79;
    expect(evaluateGate4Review(response).decision).toBe("REJECTED");
  });
  it("rejects inadequate probability, quality, or an explicit blocker", () => {
    const response = passing();
    response.answers.verdict.probabilities.APPROVED = 0.79;
    expect(evaluateGate4Review(response).decision).toBe("REJECTED");
    response.answers.verdict.probabilities.APPROVED = 0.8;
    response.answers.evidence_quality.score = 3.49;
    expect(evaluateGate4Review(response).decision).toBe("REJECTED");
    response.answers.evidence_quality.score = 3.5;
    response.answers.primary_blocker.choice = "CORRECTNESS";
    expect(evaluateGate4Review(response).decision).toBe("REJECTED");
  });
  it.each([undefined, Number.NaN, "0.99", 1.1])(
    "rejects missing or malformed scores: %s",
    (value) => {
      const response = passing();
      response.answers.regression_safe.noul = value;
      expect(evaluateGate4Review(response).decision).toBe("REJECTED");
    },
  );
  it("preserves BLOCKED and refuses missing answers", () => {
    const response = passing();
    response.answers.verdict.choice = "BLOCKED";
    expect(evaluateGate4Review(response).decision).toBe("BLOCKED");
    expect(evaluateGate4Review({}).decision).toBe("REJECTED");
  });
});
