import { beforeEach, describe, expect, test, vi } from "vitest";

const api = vi.hoisted(() => {
  const applications: unknown[] = [];
  const drift: string[] = [];
  const reads: string[] = [];
  return { applications, drift, reads, broken: new Set<string>() };
});
vi.mock("#lib/delivery/client.ts", () => ({
  deliveryRequest: vi.fn(
    (path: string, schema: { parse: (raw: unknown) => unknown }) => {
      if (path === "drift/self-healing")
        return Promise.resolve(
          schema.parse({ applications: api.applications }),
        );
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

const { observeDeliveryDrift } = await import("./monitor.ts");

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
