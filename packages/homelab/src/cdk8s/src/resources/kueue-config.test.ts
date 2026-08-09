import { describe, expect, it } from "bun:test";
import { App, Chart } from "cdk8s";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { createKueueConfig } from "@shepherdjerred/homelab/cdk8s/src/resources/kueue-config.ts";
import { createKueueApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/kueue.ts";
import { BUILDKITE_MAX_IN_FLIGHT } from "@shepherdjerred/homelab/cdk8s/src/misc/buildkite.ts";

const ClusterQueueSchema = z.object({
  apiVersion: z.literal("kueue.x-k8s.io/v1beta1"),
  kind: z.literal("ClusterQueue"),
  metadata: z.object({ name: z.string() }).loose(),
  spec: z
    .object({
      resourceGroups: z.array(
        z
          .object({
            coveredResources: z.array(z.string()),
            flavors: z.array(
              z
                .object({
                  resources: z.array(
                    z
                      .object({ name: z.string(), nominalQuota: z.string() })
                      .loose(),
                  ),
                })
                .loose(),
            ),
          })
          .loose(),
      ),
    })
    .loose(),
});

function synthKueueClusterQueue(): z.infer<typeof ClusterQueueSchema> {
  const app = new App();
  const chart = new Chart(app, "test", {});
  createKueueConfig(chart);

  const documents = app
    .synthYaml()
    .split(/^---$/m)
    .map((doc) => doc.trim())
    .filter((doc) => doc.length > 0)
    .map((document): unknown => parseYaml(document));

  for (const document of documents) {
    const result = ClusterQueueSchema.safeParse(document);
    if (result.success) return result.data;
  }
  throw new Error("Kueue ClusterQueue was not synthesized");
}

function synthKueueAppDocuments(): unknown[] {
  const app = new App();
  const chart = new Chart(app, "test", {});
  createKueueApp(chart);
  return app
    .synthYaml()
    .split(/^---$/m)
    .map((doc) => doc.trim())
    .filter((doc) => doc.length > 0)
    .map((document): unknown => parseYaml(document));
}

describe("kueue-config", () => {
  it("covers pods as a resource, alongside cpu and memory", () => {
    const clusterQueue = synthKueueClusterQueue();
    const group = clusterQueue.spec.resourceGroups[0];
    expect(group).toBeDefined();
    expect(group?.coveredResources).toContain("pods");
    expect(group?.coveredResources).toContain("cpu");
    expect(group?.coveredResources).toContain("memory");
  });

  it("uses liskov's weighted CPU and memory budget", () => {
    const clusterQueue = synthKueueClusterQueue();
    const flavor = clusterQueue.spec.resourceGroups[0]?.flavors[0];
    expect(flavor?.resources.find((r) => r.name === "cpu")?.nominalQuota).toBe(
      "24",
    );
    expect(
      flavor?.resources.find((r) => r.name === "memory")?.nominalQuota,
    ).toBe("80Gi");
  });

  it("covers ephemeral-storage (pods request it — omitting it freezes CI)", () => {
    // Every .buildkite/pipeline.yml step/dind container sets an
    // ephemeral-storage request. Kueue refuses to admit a workload that
    // requests a resource the ClusterQueue does not cover, so if this drifts
    // out every build sits Pending forever. Regression guard for the
    // 2026-07-24 freeze.
    const clusterQueue = synthKueueClusterQueue();
    const group = clusterQueue.spec.resourceGroups[0];
    expect(group?.coveredResources).toContain("ephemeral-storage");
    const flavor = group?.flavors[0];
    const eph = flavor?.resources.find((r) => r.name === "ephemeral-storage");
    expect(eph).toBeDefined();
    expect(eph?.nominalQuota).toBe("100Gi");
  });

  it("pods nominalQuota stays in lockstep with Buildkite's max-in-flight", () => {
    const clusterQueue = synthKueueClusterQueue();
    const flavor = clusterQueue.spec.resourceGroups[0]?.flavors[0];
    expect(flavor).toBeDefined();
    const podsResource = flavor?.resources.find((r) => r.name === "pods");
    expect(podsResource).toBeDefined();
    // Two independent enforcement layers (Buildkite max-in-flight, Kueue pods
    // quota) for the same concurrency cap must never drift apart — see the
    // long comment in kueue-config.ts / buildkite.ts for why both exist.
    expect(podsResource?.nominalQuota).toBe(String(BUILDKITE_MAX_IN_FLIGHT));
  });

  it("enables and selects Kueue metrics in the Prometheus namespace", () => {
    const documents = synthKueueAppDocuments();
    const application = documents.find(
      (document) =>
        z
          .object({
            kind: z.literal("Application"),
            metadata: z.object({ name: z.literal("kueue") }).loose(),
            spec: z
              .object({
                source: z
                  .object({
                    helm: z
                      .object({
                        valuesObject: z
                          .object({
                            enablePrometheus: z.literal(true),
                            metrics: z
                              .object({
                                prometheusNamespace: z.literal("prometheus"),
                              })
                              .loose(),
                          })
                          .loose(),
                      })
                      .loose(),
                  })
                  .loose(),
              })
              .loose(),
          })
          .loose()
          .safeParse(document).success,
    );
    expect(application).toBeDefined();

    const serviceMonitor = documents.find(
      (document) =>
        z
          .object({
            kind: z.literal("ServiceMonitor"),
            metadata: z
              .object({
                name: z.literal("kueue-controller-manager-metrics"),
                namespace: z.literal("kueue-system"),
                labels: z.object({ release: z.literal("prometheus") }).loose(),
              })
              .loose(),
            spec: z
              .object({
                selector: z.object({
                  matchLabels: z.object({
                    "app.kubernetes.io/instance": z.literal("kueue"),
                    "app.kubernetes.io/name": z.literal("kueue"),
                    "control-plane": z.literal("controller-manager"),
                  }),
                }),
              })
              .loose(),
          })
          .loose()
          .safeParse(document).success,
    );
    expect(serviceMonitor).toBeDefined();
  });
});
