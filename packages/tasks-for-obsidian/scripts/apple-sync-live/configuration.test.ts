import { expect, test } from "vitest";
import { assertCurrentConfigurationProof, settingsPath } from "./configuration";
import { ManifestSchema, requiredCases } from "./model";

function manifest() {
  return ManifestSchema.parse({
    schemaVersion: 1,
    runID: "1d09432f-45c4-4392-a320-3ac199963410",
    createdAt: "2026-10-11T12:00:00.000Z",
    round: 2,
    failures: [],
    completedRounds: [],
    operations: { "reference-changes": "pass" },
    simulator: null,
    stage: "initial-verified",
    allowedRemoteVaultID: "owned-vault",
    clients: null,
    reference: { [settingsPath]: { size: 100, sha256: "a".repeat(64) } },
    pluginFixtureSHA256: "b".repeat(64),
    cases: Object.fromEntries(
      requiredCases.map((name) => [
        name,
        name === "initial-download" ? "pass" : "pending",
      ]),
    ),
  });
}
function proof(value: ReturnType<typeof manifest>) {
  return {
    schemaVersion: 1,
    runID: value.runID,
    round: value.round,
    changedPath: settingsPath,
    expectedFingerprint: value.reference[settingsPath],
  };
}
test("configuration captures require successful changes and matching evidence in this round", () => {
  const value = manifest();
  expect(() =>
    assertCurrentConfigurationProof(value, proof(value)),
  ).not.toThrow();
  expect(() =>
    assertCurrentConfigurationProof({ ...value, operations: {} }, proof(value)),
  ).toThrow("current round");
  expect(() =>
    assertCurrentConfigurationProof(value, { ...proof(value), round: 1 }),
  ).toThrow("another run or round");
  expect(() =>
    assertCurrentConfigurationProof(value, {
      ...proof(value),
      runID: crypto.randomUUID(),
    }),
  ).toThrow("another run or round");
});
test("configuration captures reject stale settings fingerprints and legacy untagged evidence", () => {
  const value = manifest();
  expect(() =>
    assertCurrentConfigurationProof(value, {
      ...proof(value),
      expectedFingerprint: { size: 100, sha256: "c".repeat(64) },
    }),
  ).toThrow("current reference settings");
  expect(() =>
    assertCurrentConfigurationProof(value, {
      schemaVersion: 1,
      runID: value.runID,
      clients: [],
    }),
  ).toThrow();
  value.cases["initial-download"] = "pending";
  expect(() => assertCurrentConfigurationProof(value, proof(value))).toThrow(
    "verify",
  );
});
