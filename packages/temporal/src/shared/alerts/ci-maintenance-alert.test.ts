import { describe, expect, test } from "vitest";
import {
  buildCiMaintenanceAlerts,
  CI_MAINTENANCE_ALERT_TTL_MS,
  isFiringAlert,
  type CiMaintenanceHealthInput,
  type CiMaintenanceHealthState,
  type GoldenFreshness,
} from "./ci-maintenance-alert.ts";

const now = new Date("2026-11-27T06:00:00.000Z");
const minutesAgo = (minutes: number) =>
  new Date(now.getTime() - minutes * 60_000).toISOString();
const hoursAgo = (hours: number) =>
  new Date(now.getTime() - hours * 60 * 60_000);
const fresh: GoldenFreshness = {
  status: "selected",
  snapshot: "ci-workspace-golden-a5e4c06b821e-4dcb6168",
  snapshotCreatedAt: hoursAgo(5),
  source: { sha: "a".repeat(40), committedAt: hoursAgo(6) },
  main: { sha: "b".repeat(40), committedAt: hoursAgo(1) },
};
const idle: CiMaintenanceHealthState = {
  blocked: {},
  pending: null,
  inspectedAt: minutesAgo(4),
};

function healthy(
  state: CiMaintenanceHealthState | null = idle,
  golden: GoldenFreshness = fresh,
): CiMaintenanceHealthInput {
  return { coordinator: { state, dispatch: "on" }, golden };
}

function withPending(
  pending: NonNullable<CiMaintenanceHealthState["pending"]>,
): CiMaintenanceHealthInput {
  return healthy({ ...idle, pending });
}

const queued = (extra: object = {}) =>
  withPending({
    kind: "workspace-golden",
    requestId: "r-1",
    pipeline: 19_837,
    queuedSince: hoursAgo(1).toISOString(),
    ...extra,
  });

/** A request the latest age-out check found behind older work in its pool. */
function backlog(hours: number) {
  return queued({
    queuedSince: hoursAgo(hours).toISOString(),
    lastQueueCheck: "waiting",
  });
}

function keys(input: CiMaintenanceHealthInput) {
  return buildCiMaintenanceAlerts(input, now).map((alert) =>
    [alert.labels["alertname"], alert.labels["stream"]]
      .filter((part) => part !== undefined)
      .join(":"),
  );
}

function firing(input: CiMaintenanceHealthInput) {
  return buildCiMaintenanceAlerts(input, now)
    .filter((alert) => isFiringAlert(alert))
    .map((alert) =>
      [alert.labels["alertname"], alert.labels["stream"]]
        .filter((part) => part !== undefined)
        .join(":"),
    );
}

function firingDescription(input: CiMaintenanceHealthInput) {
  return buildCiMaintenanceAlerts(input, now).find((alert) =>
    isFiringAlert(alert),
  )?.annotations["description"];
}

describe("CI maintenance alerts", () => {
  test("a healthy tick resolves every fixed label set", () => {
    const alerts = buildCiMaintenanceAlerts(healthy(), now);
    expect(keys(healthy())).toEqual([
      "CiMaintenanceStreamBlocked:release-notes",
      "CiMaintenanceStreamBlocked:ci-images",
      "CiMaintenanceStreamBlocked:workspace-seeds",
      "CiMaintenanceStreamBlocked:workspace-golden",
      "CiMaintenanceRequestStalled",
      "CiMaintenanceCoordinatorStalled",
      "CiWorkspaceGoldenStale:workspace-golden",
    ]);
    expect(alerts[0]?.labels).toEqual({
      alertname: "CiMaintenanceStreamBlocked",
      severity: "warning",
      component: "ci-maintenance",
      temporalNamespace: "prod",
      workflowId: "ci-maintenance-coordinator",
      stream: "release-notes",
    });
    for (const alert of alerts) expect(alert.endsAt).toBe(alert.startsAt);
  });

  test("a stream blocked for more than 30 minutes fires, then resolves once retried", () => {
    const blocked = (blockedAt: string | undefined) =>
      healthy({
        ...idle,
        blocked: {
          "workspace-golden": {
            requestId: "9c1f",
            reason:
              "Pipeline 16743 ended error before starting work after 6 automatic retries; inspect before retrying",
            ...(blockedAt === undefined ? {} : { blockedAt }),
          },
        },
      });
    expect(firing(blocked(minutesAgo(29)))).toEqual([]);
    expect(firing(blocked(minutesAgo(31)))).toEqual([
      "CiMaintenanceStreamBlocked:workspace-golden",
    ]);
    // A block from before blockedAt existed is at least that old.
    expect(firing(blocked(undefined))).toEqual([
      "CiMaintenanceStreamBlocked:workspace-golden",
    ]);
    const alert = buildCiMaintenanceAlerts(blocked(minutesAgo(31)), now).find(
      (candidate) => isFiringAlert(candidate),
    );
    expect(new Date(alert?.endsAt ?? "").getTime() - now.getTime()).toBe(
      CI_MAINTENANCE_ALERT_TTL_MS,
    );
    expect(alert?.annotations["description"]).toContain(
      `--name maintenanceRetry --input '{"kind":"workspace-golden","requestId":"9c1f"}'`,
    );
    expect(firing(healthy())).toEqual([]);
  });

  test("a request the check finds behind a backlog pages only after 8 h", () => {
    // #19837 waited about 2 h 45 m behind a ~300-task pr backlog, then succeeded.
    expect(firing(backlog(3))).toEqual([]);
    expect(firing(backlog(7.9))).toEqual([]);
    expect(firing(backlog(8.1))).toEqual(["CiMaintenanceRequestStalled"]);
    expect(firingDescription(backlog(8.1))).toContain(
      "The latest check found older work ahead of it in its agent pool",
    );
  });

  test.each([undefined, "failed", "not-queued"] as const)(
    "a request whose latest check is %s pages after 2.5 h",
    (lastQueueCheck) => {
      const at = (hours: number) =>
        queued({
          queuedSince: hoursAgo(hours).toISOString(),
          ...(lastQueueCheck === undefined ? {} : { lastQueueCheck }),
        });
      expect(firing(at(2.4))).toEqual([]);
      expect(firing(at(2.6))).toEqual(["CiMaintenanceRequestStalled"]);
      expect(firingDescription(at(2.6))).toContain(
        `The latest check (${lastQueueCheck ?? "none yet"}) did not find it simply behind older work`,
      );
    },
  );

  test("a request an agent took is not a stall, however long it runs", () => {
    expect(
      firing(
        queued({
          queuedSince: hoursAgo(9).toISOString(),
          startedAt: hoursAgo(1).toISOString(),
        }),
      ),
    ).toEqual([]);
  });

  test("a request without a receipt, or whose cancel has not settled, fires", () => {
    expect(firing(queued({ cancelRequestedAt: minutesAgo(10) }))).toEqual([]);
    expect(firing(queued({ cancelRequestedAt: minutesAgo(40) }))).toEqual([
      "CiMaintenanceRequestStalled",
    ]);
    expect(
      firing(queued({ pipeline: null, queuedSince: minutesAgo(40) })),
    ).toEqual(["CiMaintenanceRequestStalled"]);
    expect(
      firing(queued({ pipeline: null, queuedSince: minutesAgo(5) })),
    ).toEqual([]);
  });

  test("a coordinator that stops inspecting pages, unless dispatch is off or unknown", () => {
    const stale = { ...idle, inspectedAt: minutesAgo(31) };
    expect(firing(healthy(stale))).toEqual(["CiMaintenanceCoordinatorStalled"]);
    expect(firingDescription(healthy(stale))).toContain(
      "workflow task is stuck",
    );
    expect(firing(healthy({ ...idle, inspectedAt: minutesAgo(29) }))).toEqual(
      [],
    );
    const off: CiMaintenanceHealthInput = {
      coordinator: { state: stale, dispatch: "off" },
      golden: fresh,
    };
    expect(firing(off)).toEqual([]);
    expect(keys(off)).toContain("CiMaintenanceCoordinatorStalled");
    for (const dispatch of ["unknown", undefined] as const)
      expect(
        keys({ coordinator: { state: stale, dispatch }, golden: fresh }),
      ).not.toContain("CiMaintenanceCoordinatorStalled");
    // A coordinator that predates inspectedAt is not judged by it.
    expect(firing(healthy({ blocked: {}, pending: null }))).toEqual([]);
  });

  test("a source that could not be read leaves out only its own occurrences", () => {
    expect(keys({ golden: fresh })).toEqual([
      "CiWorkspaceGoldenStale:workspace-golden",
    ]);
    expect(keys({ coordinator: { state: idle, dispatch: "on" } })).toEqual([
      "CiMaintenanceStreamBlocked:release-notes",
      "CiMaintenanceStreamBlocked:ci-images",
      "CiMaintenanceStreamBlocked:workspace-seeds",
      "CiMaintenanceStreamBlocked:workspace-golden",
      "CiMaintenanceRequestStalled",
      "CiMaintenanceCoordinatorStalled",
    ]);
  });

  test.each<[string, GoldenFreshness, string[]]>([
    ["fresh", fresh, []],
    ["refresh disabled", { status: "disabled" }, []],
    [
      "nothing selected",
      { status: "unselected" },
      ["CiWorkspaceGoldenStale:workspace-golden"],
    ],
    [
      "snapshot older than 36 h",
      { ...fresh, snapshotCreatedAt: hoursAgo(37) },
      ["CiWorkspaceGoldenStale:workspace-golden"],
    ],
    [
      "source more than 36 h behind main",
      { ...fresh, source: { sha: "a".repeat(40), committedAt: hoursAgo(40) } },
      ["CiWorkspaceGoldenStale:workspace-golden"],
    ],
    [
      "selected snapshot deleted",
      { ...fresh, snapshotCreatedAt: undefined },
      ["CiWorkspaceGoldenStale:workspace-golden"],
    ],
    [
      "no recorded source",
      { ...fresh, source: undefined },
      ["CiWorkspaceGoldenStale:workspace-golden"],
    ],
  ])("golden workspace %s", (_label, golden, expected) => {
    expect(firing(healthy(idle, golden))).toEqual(expected);
  });

  test("the stale golden alert names the snapshot age and source lag", () => {
    const description = firingDescription(
      healthy(idle, {
        ...fresh,
        snapshot: "ci-workspace-golden-038216cf0590-9f5e9cca",
        snapshotCreatedAt: new Date("2026-11-13T00:05:06Z"),
        source: {
          sha: "038216cf05901f269ee6556fadd0aec7bf161ec6",
          committedAt: new Date("2026-11-12T23:50:00Z"),
        },
      }),
    );
    expect(description).toContain(
      "The selected snapshot ci-workspace-golden-038216cf0590-9f5e9cca was taken 341 h ago.",
    );
    expect(description).toContain(
      `Its source 038216cf0590 trails main ${"b".repeat(12)} by 341 h.`,
    );
  });

  test("a coordinator that has not run yet raises nothing", () => {
    expect(firing(healthy(null))).toEqual([]);
  });
});
