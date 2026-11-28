import { describe, expect, test, vi } from "vitest";
import type { AlertmanagerAlert } from "#lib/alertmanager.ts";
import {
  parseCiMaintenanceHealthMemo,
  publishCiMaintenanceHealthWith,
  type CiMaintenanceHealthDeps,
} from "./ci-maintenance-health.ts";

const now = new Date("2026-11-27T06:00:00.000Z");
const main = {
  sha: "b".repeat(40),
  committedAt: new Date("2026-11-27T05:00:00Z"),
};
// The live coordinator memo shape, including fields the alerts ignore.
const memo = {
  blocked: {
    "release-notes": {
      reason: "Pipeline 14708 ended failure; inspect before retrying",
      requestId: "68644c4f-93d1-4fb1-96cd-60fd7205b988",
    },
  },
  completed: { "ci-images": "7cdf72cb" },
  goldenSnapshot: null,
  lastKind: "ci-images",
  observation: "Pipeline 19837 is pending",
  inspectedAt: "2026-11-27T05:55:00.000Z",
  pending: {
    fingerprint: "45d95901",
    frozen: false,
    kind: "workspace-golden",
    pipeline: 19_837,
    requestId: "4dcb6168-71a2-4837-8970-af3adc386730",
    source: "a5e4c06b821ef987d09a5bbbbcda166ff7dbfa86",
    queuedSince: "2026-11-27T04:35:20.467Z",
  },
};

function deps(overrides: Partial<CiMaintenanceHealthDeps> = {}) {
  const posted: AlertmanagerAlert[][] = [];
  const readCommit = vi.fn((ref: string) =>
    Promise.resolve(
      ref === "main"
        ? main
        : { sha: ref, committedAt: new Date("2026-11-12T23:50:00Z") },
    ),
  );
  const value: CiMaintenanceHealthDeps = {
    readMemo: () => Promise.resolve(memo),
    dispatchState: () => Promise.resolve("on"),
    goldenRefreshState: () => Promise.resolve("on"),
    readGoldenSelection: () =>
      Promise.resolve({
        snapshot: "ci-workspace-golden-038216cf0590-9f5e9cca",
        source: "038216cf05901f269ee6556fadd0aec7bf161ec6",
        snapshotCreatedAt: new Date("2026-11-13T00:05:06Z"),
      }),
    readCommit,
    post: (alerts) => {
      posted.push(alerts);
      return Promise.resolve();
    },
    now: () => now,
    sleep: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
  return { value, posted, readCommit };
}

function postedKeys(alerts: AlertmanagerAlert[] | undefined) {
  return (alerts ?? []).map((alert) =>
    [alert.labels["alertname"], alert.labels["stream"]]
      .filter((part) => part !== undefined)
      .join(":"),
  );
}

describe("CI maintenance health publication", () => {
  test("publishes every occurrence in one POST and reports what fires", async () => {
    const { value, posted, readCommit } = deps();
    await expect(publishCiMaintenanceHealthWith(value)).resolves.toEqual({
      firing: [
        "CiMaintenanceStreamBlocked:release-notes",
        "CiWorkspaceGoldenStale:workspace-golden",
      ],
      unknown: [],
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toHaveLength(7);
    expect(readCommit.mock.calls).toEqual([
      ["main"],
      ["038216cf05901f269ee6556fadd0aec7bf161ec6"],
    ]);
  });

  test("a failed golden read still publishes the coordinator occurrences, then fails", async () => {
    const { value, posted } = deps({
      readCommit: () => Promise.reject(new Error("GitHub 502")),
    });
    await expect(publishCiMaintenanceHealthWith(value)).rejects.toThrow(
      "could not read golden: GitHub 502; published the other occurrences",
    );
    expect(postedKeys(posted[0])).not.toContain(
      "CiWorkspaceGoldenStale:workspace-golden",
    );
    expect(postedKeys(posted[0])).toContain(
      "CiMaintenanceStreamBlocked:release-notes",
    );
  });

  test("a failed memo read still publishes the golden occurrence, then fails", async () => {
    const { value, posted } = deps({
      readMemo: () => Promise.reject(new Error("Temporal unavailable")),
    });
    await expect(publishCiMaintenanceHealthWith(value)).rejects.toThrow(
      "memo: Temporal unavailable",
    );
    expect(postedKeys(posted[0])).toEqual([
      "CiWorkspaceGoldenStale:workspace-golden",
    ]);
  });

  test("an unknown flag leaves its occurrence out instead of resolving it", async () => {
    const readGoldenSelection = vi.fn();
    const { value, posted, readCommit } = deps({
      goldenRefreshState: () => Promise.resolve("unknown"),
      dispatchState: () => Promise.resolve("unknown"),
      readGoldenSelection,
    });
    await expect(publishCiMaintenanceHealthWith(value)).resolves.toEqual({
      firing: ["CiMaintenanceStreamBlocked:release-notes"],
      unknown: ["dispatch", "golden"],
    });
    expect(readGoldenSelection).not.toHaveBeenCalled();
    expect(readCommit).not.toHaveBeenCalled();
    expect(postedKeys(posted[0])).not.toContain(
      "CiWorkspaceGoldenStale:workspace-golden",
    );
    expect(postedKeys(posted[0])).not.toContain(
      "CiMaintenanceCoordinatorStalled",
    );
  });

  test("a disabled golden refresh reads nothing and resolves its alert", async () => {
    const readGoldenSelection = vi.fn();
    const { value, readCommit } = deps({
      goldenRefreshState: () => Promise.resolve("off"),
      readGoldenSelection,
      readMemo: () => Promise.resolve(null),
    });
    await expect(publishCiMaintenanceHealthWith(value)).resolves.toEqual({
      firing: [],
      unknown: [],
    });
    expect(readGoldenSelection).not.toHaveBeenCalled();
    expect(readCommit).not.toHaveBeenCalled();
  });

  test("a stale inspection is read again a minute later, so a wake in the same tick does not page", async () => {
    // Dispatch was just turned back on: this tick's wake refreshes the memo.
    const stale = { ...memo, inspectedAt: "2026-11-27T05:00:00.000Z" };
    const reads = [stale, { ...memo, inspectedAt: "2026-11-27T06:00:40.000Z" }];
    const sleep = vi.fn(() => Promise.resolve());
    const { value, posted } = deps({
      readMemo: () => Promise.resolve(reads.shift() ?? memo),
      sleep,
      now: () => new Date("2026-11-27T06:00:00.000Z"),
    });
    const summary = await publishCiMaintenanceHealthWith(value);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(60_000);
    expect(summary.firing).not.toContain("CiMaintenanceCoordinatorStalled");
    expect(postedKeys(posted[0])).toContain("CiMaintenanceCoordinatorStalled");
  });

  test("two consecutive stale reads page", async () => {
    const stale = { ...memo, inspectedAt: "2026-11-27T05:00:00.000Z" };
    const sleep = vi.fn(() => Promise.resolve());
    const { value } = deps({ readMemo: () => Promise.resolve(stale), sleep });
    const summary = await publishCiMaintenanceHealthWith(value);
    expect(sleep).toHaveBeenCalledOnce();
    expect(summary.firing).toContain("CiMaintenanceCoordinatorStalled");
  });

  test("a fresh inspection, or dispatch off, is not read twice", async () => {
    const fresh = deps();
    await publishCiMaintenanceHealthWith(fresh.value);
    expect(fresh.value.sleep).not.toHaveBeenCalled();
    const off = deps({
      dispatchState: () => Promise.resolve("off"),
      readMemo: () =>
        Promise.resolve({ ...memo, inspectedAt: "2026-11-27T05:00:00.000Z" }),
    });
    await publishCiMaintenanceHealthWith(off.value);
    expect(off.value.sleep).not.toHaveBeenCalled();
  });

  test("a failed POST fails the activity", async () => {
    const { value } = deps({
      post: () => Promise.reject(new Error("Alertmanager POST failed: 503")),
    });
    await expect(publishCiMaintenanceHealthWith(value)).rejects.toThrow("503");
  });

  test("a malformed memo is a broken contract, not a healthy coordinator", async () => {
    expect(parseCiMaintenanceHealthMemo(undefined)).toBeNull();
    expect(() =>
      parseCiMaintenanceHealthMemo({
        blocked: { "release-notes": { requestId: "", reason: "x" } },
        pending: null,
      }),
    ).toThrow();
    expect(parseCiMaintenanceHealthMemo(memo)).toEqual({
      blocked: memo.blocked,
      inspectedAt: "2026-11-27T05:55:00.000Z",
      pending: {
        kind: "workspace-golden",
        pipeline: 19_837,
        requestId: "4dcb6168-71a2-4837-8970-af3adc386730",
        queuedSince: "2026-11-27T04:35:20.467Z",
      },
    });
    const { value } = deps({
      readMemo: () => Promise.resolve({ blocked: {}, pending: 7 }),
    });
    await expect(publishCiMaintenanceHealthWith(value)).rejects.toThrow(
      "could not read memo",
    );
  });
});
