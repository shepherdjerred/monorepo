import { describe, expect, test } from "vitest";
import { assertRoundComplete } from "./ledger";
import { ManifestSchema, requiredCases } from "./model";

function manifest() {
  return ManifestSchema.parse({
    schemaVersion: 1,
    runID: "1d09432f-45c4-4392-a320-3ac199963410",
    createdAt: "2026-10-11T12:00:00.000Z",
    round: 1,
    failures: [],
    completedRounds: [],
    operations: {},
    simulator: null,
    stage: "initial-verified",
    allowedRemoteVaultID: "owned-vault",
    clients: null,
    reference: {},
    pluginFixtureSHA256: "a".repeat(64),
    cases: Object.fromEntries(
      requiredCases.map((name) => [
        name,
        name === "three-consecutive-runs" ? "pending" : "pass",
      ]),
    ),
  });
}

describe("complete acceptance rounds", () => {
  test("requires the full matrix rather than three task captures", () => {
    const value = manifest();
    expect(() => assertRoundComplete(value)).not.toThrow();
    for (const name of requiredCases.filter(
      (item) => item !== "three-consecutive-runs",
    )) {
      expect(() =>
        assertRoundComplete({
          ...value,
          cases: { ...value.cases, [name]: "pending" },
        }),
      ).toThrow("Every acceptance case");
    }
  });
  test("rejects failed history even if case flags were overwritten", () => {
    const value = manifest();
    value.failures.push({
      round: 1,
      operation: "offline",
      capturedAt: value.createdAt,
    });
    expect(() => assertRoundComplete(value)).toThrow(
      "Failed acceptance history",
    );
    expect(() =>
      assertRoundComplete({ ...manifest(), stage: "failed" }),
    ).toThrow("Failed acceptance history");
  });
  test("rejects missing, duplicated or out-of-order prior rounds", () => {
    const value = manifest();
    value.round = 3;
    expect(() => assertRoundComplete(value)).toThrow("consecutive");
    value.completedRounds = [
      { round: 1, evidenceSHA256: "a".repeat(64) },
      { round: 1, evidenceSHA256: "b".repeat(64) },
    ];
    expect(() => assertRoundComplete(value)).toThrow("consecutive");
    value.completedRounds[1] = { round: 2, evidenceSHA256: "b".repeat(64) };
    expect(() => assertRoundComplete(value)).not.toThrow();
  });
});
