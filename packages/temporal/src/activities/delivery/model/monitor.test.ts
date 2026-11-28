import { beforeEach, describe, expect, test, vi } from "vitest";
import { PrometheusClient } from "@shepherdjerred/ops-clients/prometheus.ts";

const api = vi.hoisted(() => {
  const applications: unknown[] = [];
  const drift: string[] = [];
  const reads: string[] = [];
  const watching: unknown[] = [];
  const observations: unknown[] = [];
  return {
    applications,
    drift,
    reads,
    watching,
    observations,
    broken: new Set<string>(),
  };
});
vi.mock("#lib/delivery/client.ts", () => ({
  deliveryRequest: vi.fn(
    (
      path: string,
      schema: { parse: (raw: unknown) => unknown },
      body?: unknown,
    ) => {
      if (path === "drift/self-healing")
        return Promise.resolve(
          schema.parse({ applications: api.applications }),
        );
      if (path === "monitors/watching") {
        return Promise.resolve(schema.parse(api.watching));
      }
      if (path.endsWith("/monitor/observations")) {
        api.observations.push({ path, body });
        return Promise.resolve(undefined);
      }
      api.drift.push(path);
      return Promise.resolve(undefined);
    },
  ),
}));
vi.mock("#lib/delivery/argo-client.ts", () => ({
  getArgoApplication: vi.fn((name: string) => {
    api.reads.push(name);
    if (api.broken.has(name))
      return Promise.reject(new Error(`ArgoCD read of ${name} failed`));
    return Promise.resolve({
      status: {
        operationState: {
          phase: "Succeeded",
          startedAt: "2026-10-22T12:00:00Z",
          operation: { initiatedBy: { automated: true } },
        },
      },
    });
  }),
}));

const { observeDeliveryDrift, observeDeliveryMonitors } =
  await import("./monitor.ts");

test("observeDeliveryMonitors renders the accepted timestamp independently of observation time", async () => {
  const gitSha = "a".repeat(40);
  api.watching.push({
    deploymentId: "accepted-deployment",
    environmentId: "example/prod",
    serviceId: "example",
    acceptedAt: "2026-10-22T00:00:00.123Z",
    monitor: {
      component: "image:example",
      alarms: { matchers: { environment: "prod" } },
      evidence: [
        {
          key: "accepted-receipts",
          query:
            'sum(increase(x{version="$version",git_sha="$gitSha"}[$window])) and on() sum(timestamp(x) >= $acceptedAt)',
          threshold: 50,
        },
      ],
      policy: "automatic",
    },
    artifact: {
      component: "image:example",
      version: "1.2.3",
      gitSha,
      digest: `sha256:${"b".repeat(64)}`,
    },
  });
  vi.setSystemTime(new Date("2026-10-22T00:00:30.456Z"));
  const query = vi
    .spyOn(PrometheusClient.prototype, "query")
    .mockRejectedValue(new Error("Unexpected Prometheus query"))
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ metric: {}, value: 51 }]);
  try {
    await expect(observeDeliveryMonitors()).resolves.toEqual({ observed: 1 });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenLastCalledWith(
      `sum(increase(x{version="1.2.3",git_sha="${gitSha}"}[120s])) and on() sum(timestamp(x) >= 1792627200.123)`,
      undefined,
    );
    expect(api.observations).toEqual([
      {
        path: "deployments/accepted-deployment/monitor/observations",
        body: {
          observedAt: "2026-10-22T00:00:30.456Z",
          window: "120s",
          alarms: [],
          evidence: { "accepted-receipts": 51 },
        },
      },
    ]);
  } finally {
    query.mockRestore();
    vi.useRealTimers();
    api.watching.length = 0;
    api.observations.length = 0;
  }
});

function selfHealing(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    deploymentId: `deployment-${String(index)}`,
    environmentId: `app-${String(index)}/prod`,
    application: `app-${String(index)}`,
    acceptedAt: "2026-10-22T00:00:00.000Z",
  }));
}

describe("observeDeliveryDrift (T4)", () => {
  beforeEach(() => {
    api.drift.length = 0;
    api.reads.length = 0;
    api.broken.clear();
  });

  test("reads every self-healing Application each tick, past the first fifty", async () => {
    api.applications.splice(0, Infinity, ...selfHealing(60));
    await expect(observeDeliveryDrift()).resolves.toEqual({ recorded: 60 });
    expect(api.reads).toHaveLength(60);
    expect(api.drift).toContain("deployments/deployment-59/drift");
  });

  test("a failed read surfaces only after every other Application was read", async () => {
    api.applications.splice(0, Infinity, ...selfHealing(3));
    api.broken.add("app-0");
    await expect(observeDeliveryDrift()).rejects.toThrow(
      "1 of 3 self-healing Application reads failed",
    );
    expect(api.reads).toEqual(["app-0", "app-1", "app-2"]);
    expect(api.drift).toEqual([
      "deployments/deployment-1/drift",
      "deployments/deployment-2/drift",
    ]);
  });
});
