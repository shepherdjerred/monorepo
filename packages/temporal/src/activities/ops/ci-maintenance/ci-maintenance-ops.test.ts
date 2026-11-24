import { WorkflowNotFoundError } from "@temporalio/client";
import { SignalSchema } from "@shepherdjerred/ops-model/snapshot.ts";
import { describe, expect, test } from "vitest";
import {
  collectCiMaintenanceBlockedSignals,
  describeCiMaintenanceMemo,
  mapCiMaintenanceBlockedSignals,
  parseBlockedPipelineNumber,
} from "./ci-maintenance-ops.ts";

const now = new Date("2026-11-24T17:30:00.000Z");

describe("CI maintenance Ops blocked-stream signals", () => {
  test("extracts pipeline numbers only from pipeline failure reasons", () => {
    expect(
      parseBlockedPipelineNumber(
        "Pipeline 14708 ended failure; inspect before retrying",
      ),
    ).toBe(14_708);
    expect(
      parseBlockedPipelineNumber(
        "Operator confirmed submission absent: API audit verified no POST landed",
      ),
    ).toBeUndefined();
  });

  test("alerts on pre-existing blocks without blockedAt and links to Woodpecker when known", () => {
    const signals = mapCiMaintenanceBlockedSignals(
      {
        blocked: {
          "release-notes": {
            requestId: "req-release",
            reason: "Pipeline 14708 ended failure; inspect before retrying",
          },
          "workspace-golden": {
            requestId: "req-golden",
            reason:
              "Operator confirmed submission absent: API audit verified no POST landed",
          },
        },
      },
      {
        now,
        woodpeckerBaseUrl: "https://woodpecker.sjer.red",
        woodpeckerRepoId: 1,
      },
    ).map((signal) => SignalSchema.parse(signal));

    expect(signals).toHaveLength(2);
    expect(signals[0]).toMatchObject({
      id: "temporal:ci-maintenance:release-notes:blocked",
      source: "temporal",
      section: "maintenance",
      kind: "ci-maintenance-blocked",
      severity: "warning",
      needsMe: true,
      title: "CI maintenance release-notes blocked by pipeline #14708",
      detail: "Pipeline 14708 ended failure; inspect before retrying",
      attributes: {
        maintenanceKind: "release-notes",
        requestId: "req-release",
        pipeline: 14_708,
      },
      links: [
        {
          kind: "woodpecker",
          label: "Pipeline #14708",
          url: "https://woodpecker.sjer.red/repos/1/pipeline/14708",
        },
        {
          kind: "temporal",
          label: "Coordinator workflow",
          url: "https://temporal-ui.tailnet-1a49.ts.net/namespaces/prod/workflows/ci-maintenance-coordinator",
        },
      ],
    });
    expect(signals[0]?.since).toBeUndefined();

    expect(signals[1]).toMatchObject({
      id: "temporal:ci-maintenance:workspace-golden:blocked",
      source: "temporal",
      section: "maintenance",
      kind: "ci-maintenance-blocked",
      severity: "warning",
      needsMe: true,
      title: "CI maintenance workspace-golden is blocked",
      links: [
        {
          kind: "temporal",
          label: "Coordinator workflow",
          url: "https://temporal-ui.tailnet-1a49.ts.net/namespaces/prod/workflows/ci-maintenance-coordinator",
        },
      ],
    });
  });

  test("suppresses blocks up to 5 minutes old and alerts once older than 5 minutes", () => {
    const recentMemo = {
      blocked: {
        "ci-images": {
          requestId: "req-recent",
          reason: "Pipeline 18001 ended failure; inspect before retrying",
          blockedAt: "2026-11-24T17:25:00.000Z", // exactly 5m00s ago
        },
        "workspace-seeds": {
          requestId: "req-older",
          reason: "Pipeline 18002 ended error; inspect before retrying",
          blockedAt: "2026-11-24T17:24:59.000Z", // 5m01s ago
        },
      },
    };
    const signals = mapCiMaintenanceBlockedSignals(recentMemo, { now }).map(
      (signal) => SignalSchema.parse(signal),
    );
    expect(signals.map((signal) => signal.id)).toEqual([
      "temporal:ci-maintenance:workspace-seeds:blocked",
    ]);
    expect(signals[0]).toMatchObject({
      since: "2026-11-24T17:24:59.000Z",
      links: [
        {
          kind: "woodpecker",
          label: "Pipeline #18002",
          url: "https://woodpecker.sjer.red/repos/1/pipeline/18002",
        },
        {
          kind: "temporal",
          label: "Coordinator workflow",
        },
      ],
    });
  });

  test("handles WorkflowNotFoundError as an empty signal list and rethrows other errors", async () => {
    const missingMemo = await describeCiMaintenanceMemo(() =>
      Promise.reject(
        new WorkflowNotFoundError(
          "workflow not found",
          "ci-maintenance-coordinator",
          undefined,
        ),
      ),
    );
    expect(missingMemo).toBeNull();
    await expect(
      collectCiMaintenanceBlockedSignals({ now }, () =>
        Promise.resolve(missingMemo),
      ),
    ).resolves.toEqual([]);

    await expect(
      describeCiMaintenanceMemo(() =>
        Promise.reject(new Error("gRPC unavailable")),
      ),
    ).rejects.toThrow("gRPC unavailable");
  });
});
