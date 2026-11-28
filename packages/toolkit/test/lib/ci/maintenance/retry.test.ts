import { expect, test } from "vitest";
import {
  formatMaintenanceRetry,
  maintenanceRetry,
  planMaintenanceRetry,
  type CiMaintenanceMemo,
  type RetryDeps,
} from "#lib/ci/maintenance/retry.ts";

const memo = (extra: Partial<CiMaintenanceMemo> = {}): CiMaintenanceMemo => ({
  blocked: {
    "workspace-golden": {
      requestId: "req-golden",
      reason: "Pipeline 16743 ended error; inspect before retrying",
    },
  },
  pending: null,
  observation: "idle",
  ...extra,
});

test("plans a retry bound to the blocked request when nothing is pending", () => {
  expect(planMaintenanceRetry(memo(), "workspace-golden")).toEqual({
    action: "send",
    kind: "workspace-golden",
    requestId: "req-golden",
    blockedReason: "Pipeline 16743 ended error; inspect before retrying",
  });
});

test("refuses, with the reason, when the stream is not blocked or a request is pending", () => {
  const notBlocked = planMaintenanceRetry(memo(), "ci-images");
  expect(notBlocked).toMatchObject({ action: "refuse" });
  expect(JSON.stringify(notBlocked)).toContain("workspace-golden");
  const pending = planMaintenanceRetry(
    memo({
      pending: {
        kind: "ci-images",
        requestId: "req-pending",
        pipeline: 19_772,
      },
    }),
    "workspace-golden",
  );
  expect(pending).toMatchObject({ action: "refuse" });
  expect(JSON.stringify(pending)).toContain("19772");
  expect(planMaintenanceRetry(null, "workspace-golden")).toMatchObject({
    action: "refuse",
  });
});

function deps(reads: (CiMaintenanceMemo | null)[]) {
  const sent: unknown[] = [];
  const dependencies: RetryDeps = {
    read: () => Promise.resolve(reads.shift() ?? null),
    send: (plan) => {
      sent.push({ kind: plan.kind, requestId: plan.requestId });
      return Promise.resolve();
    },
    sleep: () => Promise.resolve(),
  };
  return { dependencies, sent };
}

test("a dry run reads the memo and sends nothing", async () => {
  const { dependencies, sent } = deps([memo()]);
  const report = await maintenanceRetry(
    "workspace-golden",
    false,
    undefined,
    dependencies,
  );
  expect(sent).toEqual([]);
  expect(report).toMatchObject({ dryRun: true, sent: false });
  expect(formatMaintenanceRetry(report)).toContain("pass --apply");
});

test("apply sends the signal and reads the memo back until the block clears", async () => {
  const { dependencies, sent } = deps([
    memo(),
    memo(),
    memo({ blocked: {}, observation: "Pipeline 19900 is pending" }),
  ]);
  const report = await maintenanceRetry(
    "workspace-golden",
    true,
    undefined,
    dependencies,
  );
  expect(sent).toEqual([{ kind: "workspace-golden", requestId: "req-golden" }]);
  expect(report).toMatchObject({
    sent: true,
    blockCleared: true,
    observation: "Pipeline 19900 is pending",
  });
});

test("apply never sends when the retry is refused", async () => {
  const { dependencies, sent } = deps([memo({ blocked: {} })]);
  const report = await maintenanceRetry(
    "workspace-golden",
    true,
    undefined,
    dependencies,
  );
  expect(sent).toEqual([]);
  expect(report.sent).toBe(false);
  expect(formatMaintenanceRetry(report)).toContain("is not blocked");
});

test("a missing memo or a re-block under a new request ID is not a clear", async () => {
  for (const after of [
    null,
    memo({
      blocked: {
        "workspace-golden": { requestId: "req-new", reason: "blocked again" },
      },
    }),
  ]) {
    const { dependencies, sent } = deps([
      memo(),
      ...Array.from({ length: 15 }, () => after),
    ]);
    const report = await maintenanceRetry(
      "workspace-golden",
      true,
      undefined,
      dependencies,
    );
    expect(sent).toHaveLength(1);
    expect(report).toMatchObject({ sent: true, blockCleared: false });
  }
});
