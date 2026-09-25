import { describe, expect, test } from "vitest";
import type { AlertmanagerAlert } from "@shepherdjerred/ops-clients/alertmanager.ts";
import type {
  ArgoApplication,
  PodStatus,
} from "@shepherdjerred/ops-clients/kubernetes.ts";
import { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import { SignalSchema } from "@shepherdjerred/ops-model/snapshot.ts";
import { alertSeverity, mapAlerts } from "./alerts.ts";
import {
  argoAppState,
  mapArgoApplications,
  updateOutOfSyncSince,
} from "./argocd.ts";
import { mapKubernetes, podSeverity } from "./kubernetes.ts";
import {
  mapTalos,
  parseMachineStatuses,
  parseServices,
  splitJsonDocuments,
} from "./talos.ts";

const now = new Date("2026-09-24T12:00:00.000Z");
const context = { now, services: new ServiceIndex() };

function minutesAgo(minutes: number): string {
  return new Date(now.getTime() - minutes * 60_000).toISOString();
}

function alert(
  labels: Record<string, string>,
  startedMinutesAgo: number,
): AlertmanagerAlert {
  return {
    fingerprint: `fp-${labels["alertname"] ?? "x"}`,
    labels,
    annotations: { summary: `${labels["alertname"] ?? "x"} summary` },
    startsAt: minutesAgo(startedMinutesAgo),
    status: { state: "active", silencedBy: [], inhibitedBy: [] },
  };
}

describe("alerts", () => {
  test.each([
    ["critical", "error"],
    ["warning", "warning"],
    ["info", "info"],
    ["page-me", "warning"],
  ])("severity label %s maps to %s", (label, expected) => {
    expect(alertSeverity(alert({ severity: label }, 1))).toBe(expected);
  });

  test("needsMe after 30 minutes, drops the watchdog, maps the service", () => {
    const result = mapAlerts(
      [
        alert({ alertname: "Watchdog", severity: "none" }, 600),
        alert(
          {
            alertname: "BirmelDown",
            severity: "critical",
            namespace: "birmel",
          },
          45,
        ),
        alert({ alertname: "DiskFilling", severity: "warning" }, 5),
      ],
      [],
      context,
    );
    expect(
      result.signals.map((s) => [s.id, s.severity, s.needsMe, s.service]),
    ).toEqual([
      ["alerts:fp-BirmelDown", "error", true, "birmel"],
      ["alerts:fp-DiskFilling", "warning", false, undefined],
    ]);
    expect(result.metrics.map((m) => [m.id, m.value])).toEqual([
      ["alerts.firing", 2],
      ["alerts.critical", 1],
      ["alerts.warning", 1],
    ]);
    expect(result.changes).toEqual([]);
    for (const signal of result.signals) {
      expect(() => SignalSchema.parse(signal)).not.toThrow();
    }
  });
});

function pod(overrides: Partial<PodStatus>): PodStatus {
  return {
    namespace: "birmel",
    name: "birmel-abc",
    phase: "Running",
    createdAt: minutesAgo(60),
    ownerKind: "ReplicaSet",
    restarts: 0,
    problem: undefined,
    stuck: false,
    ...overrides,
  };
}

describe("kubernetes", () => {
  test("pod severity policy", () => {
    expect(podSeverity(pod({}), now)).toBeUndefined();
    expect(
      podSeverity(pod({ problem: "app: CrashLoopBackOff", stuck: true }), now),
    ).toBe("error");
    expect(
      podSeverity(
        pod({ phase: "Pending", problem: "Pending", createdAt: minutesAgo(2) }),
        now,
      ),
    ).toBeUndefined();
    expect(
      podSeverity(
        pod({
          phase: "Pending",
          problem: "Pending",
          createdAt: minutesAgo(30),
        }),
        now,
      ),
    ).toBe("warning");
    expect(podSeverity(pod({ phase: "Failed", problem: "Evicted" }), now)).toBe(
      "info",
    );
  });

  test("a NotReady node is an error and counted", () => {
    const result = mapKubernetes(
      [
        {
          name: "torvalds",
          ready: true,
          readySince: undefined,
          osImage: "Talos",
          kubeletVersion: "v1",
        },
        {
          name: "liskov",
          ready: false,
          readySince: minutesAgo(10),
          osImage: "Talos",
          kubeletVersion: "v1",
        },
      ],
      [pod({ problem: "app: ImagePullBackOff", stuck: true })],
      context,
    );
    expect(result.signals.map((s) => [s.id, s.severity])).toEqual([
      ["kubernetes:node:liskov", "error"],
      ["kubernetes:pod:birmel/birmel-abc", "error"],
    ]);
    expect(result.metrics.find((m) => m.id === "nodes.ready")).toMatchObject({
      value: 1,
      severity: "error",
    });
    expect(result.metrics.find((m) => m.id === "pods.unhealthy")?.value).toBe(
      1,
    );
  });
});

function app(overrides: Partial<ArgoApplication>): ArgoApplication {
  return {
    name: "birmel",
    project: "default",
    destinationNamespace: "birmel",
    sync: "Synced",
    health: "Healthy",
    revision: "0123456789abcdef0123456789abcdef01234567",
    history: [],
    operation: undefined,
    ...overrides,
  };
}

describe("argocd", () => {
  test("OutOfSync is info within the grace period and a warning after it", () => {
    const outOfSync = app({ sync: "OutOfSync" });
    expect(argoAppState(outOfSync, new Date(minutesAgo(5)), now).severity).toBe(
      "info",
    );
    expect(
      argoAppState(outOfSync, new Date(minutesAgo(20)), now).severity,
    ).toBe("warning");
    const syncing = app({
      sync: "OutOfSync",
      operation: {
        phase: "Running",
        message: undefined,
        startedAt: minutesAgo(1),
        finishedAt: undefined,
      },
    });
    expect(argoAppState(syncing, new Date(minutesAgo(20)), now).severity).toBe(
      "info",
    );
  });

  test("Degraded is an error and a failed sync needs me", () => {
    expect(
      argoAppState(app({ health: "Degraded" }), undefined, now),
    ).toMatchObject({
      severity: "error",
      needsMe: false,
    });
    const failed = argoAppState(
      app({
        operation: {
          phase: "Failed",
          message: "hook failed",
          startedAt: minutesAgo(3),
          finishedAt: minutesAgo(2),
        },
      }),
      undefined,
      now,
    );
    expect(failed).toMatchObject({ severity: "error", needsMe: true });
  });

  test("tracks OutOfSync onset and emits recent deploys as changes", () => {
    const tracker = new Map<string, Date>();
    updateOutOfSyncSince(
      tracker,
      [app({ sync: "OutOfSync" })],
      new Date(minutesAgo(20)),
    );
    updateOutOfSyncSince(tracker, [app({ sync: "OutOfSync" })], now);
    expect(tracker.get("birmel")?.toISOString()).toBe(minutesAgo(20));
    const result = mapArgoApplications(
      [
        app({
          sync: "OutOfSync",
          history: [
            {
              id: 1,
              revision: "aaaaaaa",
              deployedAt: minutesAgo(60 * 48),
              deployStartedAt: undefined,
            },
            {
              id: 2,
              revision: "bbbbbbb",
              deployedAt: minutesAgo(30),
              deployStartedAt: undefined,
            },
          ],
        }),
        app({ name: "unknown-app", destinationNamespace: undefined }),
      ],
      tracker,
      context,
    );
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).toMatchObject({
      id: "argocd:app:birmel",
      severity: "warning",
      service: "birmel",
      since: minutesAgo(20),
    });
    expect(result.changes.map((c) => c.externalId)).toEqual([
      "birmel:deploy:2",
    ]);
    expect(result.signals[0]?.links?.[0]?.url).toBe(
      "https://argocd.tailnet-1a49.ts.net/applications/argocd/birmel",
    );
    updateOutOfSyncSince(tracker, [app({})], now);
    expect(tracker.size).toBe(0);
  });
});

describe("talos", () => {
  const machineStatus = `{
    "node": "192.168.1.81",
    "metadata": {"namespace": "runtime", "id": "machine"},
    "spec": {"stage": "running", "status": {"ready": false, "unmetConditions": [{"name": "nodeReady", "reason": "node not ready"}]}}
}
{
    "node": "192.168.1.82",
    "metadata": {"namespace": "runtime", "id": "machine"},
    "spec": {"stage": "running", "status": {"ready": true, "unmetConditions": null}}
}`;
  const services = `{"node": "192.168.1.81", "metadata": {"id": "etcd"}, "spec": {"running": true, "healthy": false, "unknown": false}}
{"node": "192.168.1.81", "metadata": {"id": "udevd"}, "spec": {"running": true, "healthy": false, "unknown": true}}
{"node": "192.168.1.81", "metadata": {"id": "kubelet"}, "spec": {"running": false, "healthy": false, "unknown": false}}`;

  test("splits concatenated documents, including braces inside strings", () => {
    expect(splitJsonDocuments('{"a": "}{"}\n{"b": {"c": 1}}')).toEqual([
      { a: "}{" },
      { b: { c: 1 } },
    ]);
    expect(() => splitJsonDocuments('{"a": 1')).toThrow(/ended inside/);
  });

  test("maps not-ready machines and failing services", () => {
    const result = mapTalos(
      parseMachineStatuses(machineStatus),
      parseServices(services),
    );
    expect(result.signals.map((s) => [s.id, s.severity])).toEqual([
      ["talos:machine:192.168.1.81", "error"],
      ["talos:service:192.168.1.81:etcd", "warning"],
      ["talos:service:192.168.1.81:kubelet", "error"],
    ]);
    expect(result.signals[0]?.detail).toBe("nodeReady: node not ready");
  });

  test("no machine status is a failed source", () => {
    expect(() => mapTalos([], [])).toThrow(/no machine status/);
  });
});
