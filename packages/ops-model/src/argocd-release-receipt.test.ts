import { expect, test } from "vitest";
import fixture from "./fixtures/verified-root-release.json" with { type: "json" };
import {
  isVerifiedRootReleaseTermination,
  VERIFIED_ROOT_RELEASE_ANNOTATION,
  VerifiedRootReleaseReceiptSchema,
} from "./argocd-release-receipt.ts";

test("recognizes only a verified receipt for the exact owned prune termination", () => {
  expect(isVerifiedRootReleaseTermination(fixture)).toBe(true);
  const missing = structuredClone(fixture);
  missing.metadata.annotations = { [VERIFIED_ROOT_RELEASE_ANNOTATION]: "" };
  expect(() => isVerifiedRootReleaseTermination(missing)).toThrow();
  expect(
    isVerifiedRootReleaseTermination({
      ...fixture,
      metadata: { name: "apps" },
    }),
  ).toBe(false);
});

test.each([
  "name",
  "sync",
  "phase",
  "message",
  "initiator",
  "revision",
  "result-revision",
  "prune",
  "hook",
  "duplicate-identity",
  "request",
  "operation",
])("rejects %s mismatches even with a valid receipt", (mismatch) => {
  const app = structuredClone(fixture);
  const state = app.status.operationState;
  switch (mismatch) {
    case "name":
      app.metadata.name = "other";
      break;
    case "sync":
      app.status.sync.status = "OutOfSync";
      break;
    case "phase":
      state.phase = "Error";
      break;
    case "message":
      state.message = "Hook failed";
      break;
    case "initiator":
      state.operation.initiatedBy.username = "admin";
      break;
    case "revision":
      app.status.sync.revision = "2.0.0-43";
      break;
    case "result-revision":
      state.syncResult.revision = "2.0.0-43";
      break;
    case "prune":
      state.operation.sync.prune = false;
      break;
    case "hook":
      state.syncResult.resources = [
        { status: "SyncFailed", hookPhase: "Failed" },
      ];
      break;
    case "duplicate-identity":
      state.operation.info.push({
        name: "ci.sjer.red/operation-id",
        value: "11111111-1111-4111-8111-111111111111",
      });
      break;
    case "request":
      state.operation.info = state.operation.info.map((entry) =>
        entry.name === "ci.sjer.red/request-id"
          ? { ...entry, value: "00000000-0000-4000-8000-000000000043" }
          : entry,
      );
      break;
    case "operation":
      state.operation.info = state.operation.info.filter(
        (entry) => entry.name !== "ci.sjer.red/operation-id",
      );
      break;
  }
  expect(isVerifiedRootReleaseTermination(app)).toBe(false);
});

test("rejects verification before termination and a receipt for another occurrence", () => {
  for (const changed of [
    { verifiedAt: "2026-10-13T00:00:30.000Z" },
    { operationStartedAt: "2026-10-12T00:00:00.000Z" },
  ]) {
    const app = structuredClone(fixture);
    const receipt = VerifiedRootReleaseReceiptSchema.parse(
      JSON.parse(app.metadata.annotations[VERIFIED_ROOT_RELEASE_ANNOTATION]),
    );
    app.metadata.annotations[VERIFIED_ROOT_RELEASE_ANNOTATION] = JSON.stringify(
      { ...receipt, ...changed },
    );
    expect(isVerifiedRootReleaseTermination(app)).toBe(false);
  }
});

test("does not turn current progressing health into healthy", () => {
  const app = structuredClone(fixture);
  app.status.health.status = "Progressing";
  expect(isVerifiedRootReleaseTermination(app)).toBe(true);
});
