import { expect, test } from "vitest";
import {
  requireCheckpointTransition,
  requireVaultTransition,
  StoredCheckpointSchema,
  type StoredCheckpoint,
} from "./state.ts";

const runID = "a08cefd8-2f57-4f03-89e9-1d2bd344a679",
  sha = "a".repeat(64);
function checkpoint(round = 1): StoredCheckpoint {
  return StoredCheckpointSchema.parse({
    schemaVersion: 1,
    kind: "tart-guest-account-checkpoint",
    guestConfigSHA256: sha,
    binding: { runID, allowedRemoteVaultID: "synthetic-remote", round },
    checkpoint: {
      stage: "bound",
      scope: "macos",
      officialReferencePassed: true,
      initialDownloadPassed: false,
      lifecycleBeginPassed: false,
      lifecycleFinishPresent: false,
      failuresCount: 0,
      completedRounds: Array.from({ length: round - 1 }, (_, index) => ({
        round: index + 1,
        evidenceSHA256: sha,
      })),
    },
  });
}
test("vault grant permits exactly one identity and never reset or replacement", () => {
  expect(() => requireVaultTransition(null, "synthetic-remote")).not.toThrow();
  expect(() =>
    requireVaultTransition("synthetic-remote", "synthetic-remote"),
  ).not.toThrow();
  for (const next of [null, "other-remote"])
    expect(() => requireVaultTransition("synthetic-remote", next)).toThrow(
      "cannot reset or change",
    );
});
test("fresh checkpoint starts at round1 without fabricated prior evidence", () => {
  expect(() => requireCheckpointTransition(null, checkpoint())).not.toThrow();
  expect(() => requireCheckpointTransition(null, checkpoint(2))).toThrow();
});
test("round advancement retains complete sequential evidence and immutable source/config/run scope", () => {
  expect(() =>
    requireCheckpointTransition(checkpoint(), checkpoint(2)),
  ).not.toThrow();
  expect(() =>
    requireCheckpointTransition(checkpoint(2), checkpoint(3)),
  ).not.toThrow();
  for (const mutate of [
    (value: StoredCheckpoint) => {
      value.checkpoint.completedRounds = [];
    },
    (value: StoredCheckpoint) => {
      value.binding.round = 3;
    },
    (value: StoredCheckpoint) => {
      value.guestConfigSHA256 = "b".repeat(64);
    },
    (value: StoredCheckpoint) => {
      value.binding.runID = crypto.randomUUID();
    },
    (value: StoredCheckpoint) => {
      value.binding.allowedRemoteVaultID = "foreign";
    },
    (value: StoredCheckpoint) => {
      value.checkpoint.scope = "apple";
    },
  ]) {
    const next = checkpoint(2);
    mutate(next);
    expect(() => requireCheckpointTransition(checkpoint(), next)).toThrow();
  }
});
test("retained completed-round digest cannot be changed on next round", () => {
  const next = checkpoint(3);
  const first = next.checkpoint.completedRounds[0];
  expect(first).toBeDefined();
  if (first) first.evidenceSHA256 = "b".repeat(64);
  expect(() => requireCheckpointTransition(checkpoint(2), next)).toThrow();
  expect(() =>
    requireCheckpointTransition(checkpoint(2), checkpoint()),
  ).toThrow();
});
test("failure history and failed/cleaned stages cannot reset", () => {
  const previous = checkpoint();
  previous.checkpoint.failuresCount = 1;
  previous.checkpoint.stage = "failed";
  expect(() => requireCheckpointTransition(previous, checkpoint())).toThrow();
  const next = checkpoint();
  next.checkpoint.failuresCount = 1;
  expect(() => requireCheckpointTransition(previous, next)).toThrow();
  const cleaned = checkpoint();
  cleaned.checkpoint.stage = "cleaned";
  expect(() => requireCheckpointTransition(cleaned, checkpoint())).toThrow();
});
