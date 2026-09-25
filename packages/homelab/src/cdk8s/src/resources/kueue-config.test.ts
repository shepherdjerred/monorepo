import { describe, expect, it } from "vitest";
import { App, Chart } from "cdk8s";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  CI_CLUSTER_QUEUE,
  CI_MAINTENANCE_CLUSTER_QUEUE,
  CI_MAINTENANCE_LOCAL_QUEUE,
  createKueueConfig,
} from "@shepherdjerred/homelab/cdk8s/src/resources/kueue-config.ts";
import { createKueueApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/kueue.ts";
import { CI_ADMISSION_BUDGET } from "@shepherdjerred/homelab/cdk8s/src/misc/woodpecker.ts";

const ClusterQueueSchema = z.object({
  apiVersion: z.literal("kueue.x-k8s.io/v1beta2"),
  kind: z.literal("ClusterQueue"),
  metadata: z.object({ name: z.string() }).loose(),
  spec: z
    .object({
      namespaceSelector: z.object({
        matchLabels: z.record(z.string(), z.string()),
      }),
      preemption: z.object({
        withinClusterQueue: z.string(),
        reclaimWithinCohort: z.string(),
      }),
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

const LocalQueueSchema = z.object({
  apiVersion: z.literal("kueue.x-k8s.io/v1beta2"),
  kind: z.literal("LocalQueue"),
  metadata: z.object({ name: z.string(), namespace: z.string() }).loose(),
  spec: z.object({ clusterQueue: z.string() }),
});

function synthDocuments(create: (chart: Chart) => unknown): unknown[] {
  const app = new App();
  const chart = new Chart(app, "test", {});
  create(chart);
  return app
    .synthYaml()
    .split(/^---$/m)
    .map((doc) => doc.trim())
    .filter((doc) => doc.length > 0)
    .map((document): unknown => parseYaml(document));
}

function clusterQueue(name: string): z.infer<typeof ClusterQueueSchema> {
  for (const document of synthDocuments(createKueueConfig)) {
    const result = ClusterQueueSchema.safeParse(document);
    if (result.success && result.data.metadata.name === name) {
      return result.data;
    }
  }
  throw new Error(`ClusterQueue ${name} was not synthesized`);
}

function quota(name: string, resource: string): string | undefined {
  return clusterQueue(name).spec.resourceGroups[0]?.flavors[0]?.resources.find(
    (entry) => entry.name === resource,
  )?.nominalQuota;
}

function localQueues(): z.infer<typeof LocalQueueSchema>[] {
  return synthDocuments(createKueueConfig)
    .map((document) => LocalQueueSchema.safeParse(document))
    .filter((result) => result.success)
    .map((result) => result.data);
}

function synthKueueAppDocuments(): unknown[] {
  return synthDocuments(createKueueApp);
}

describe("kueue-config", () => {
  it("covers pods and ephemeral-storage alongside cpu and memory", () => {
    // Every CI container requests ephemeral-storage, and Kueue refuses a
    // workload requesting a resource its ClusterQueue does not cover: if this
    // drifts, every build sits gated forever. Regression guard for the
    // 2026-07-24 freeze.
    for (const name of [CI_CLUSTER_QUEUE, CI_MAINTENANCE_CLUSTER_QUEUE]) {
      expect(
        clusterQueue(name).spec.resourceGroups[0]?.coveredResources,
      ).toEqual(["cpu", "memory", "pods", "ephemeral-storage"]);
    }
  });

  it("takes the CI budget from its language-neutral source", () => {
    expect(quota(CI_CLUSTER_QUEUE, "cpu")).toBe("24");
    expect(quota(CI_CLUSTER_QUEUE, "memory")).toBe("80Gi");
    expect(quota(CI_CLUSTER_QUEUE, "ephemeral-storage")).toBe("100Gi");
    expect(CI_ADMISSION_BUDGET.quota).toEqual({
      cpu: "24",
      memory: "80Gi",
      "ephemeral-storage": "100Gi",
    });
  });

  /**
   * Counted in pods, not workflows: a workflow has its step and each of its
   * services admitted at once. Sized so the pods quota never binds before the
   * agent's workflow cap does.
   */
  it("sizes the pods backstop from the workflow cap and services", () => {
    const perWorkflow = 1 + CI_ADMISSION_BUDGET.maxServicesPerWorkflow;
    expect(quota(CI_CLUSTER_QUEUE, "pods")).toBe(
      String(CI_ADMISSION_BUDGET.maxWorkflows * perWorkflow),
    );
  });

  it("admits only the CI namespace, and never preempts", () => {
    for (const name of [CI_CLUSTER_QUEUE, CI_MAINTENANCE_CLUSTER_QUEUE]) {
      const { spec } = clusterQueue(name);
      expect(spec.namespaceSelector.matchLabels).toEqual({
        "kubernetes.io/metadata.name": "woodpecker-ci",
      });
      // Kueue stops a plain pod by deleting it, which Woodpecker would read
      // as a step that succeeded.
      expect(spec.preemption).toEqual({
        withinClusterQueue: "Never",
        reclaimWithinCohort: "Never",
      });
    }
  });

  /**
   * `default` is what makes Kueue queue a pod that names no queue, which is
   * every pod Woodpecker creates. The maintenance worker names its own queue
   * so it never holds CI quota.
   */
  it("queues unlabelled CI pods by default and the maintenance worker apart", () => {
    expect(
      localQueues().map(({ metadata, spec }) => [
        metadata.namespace,
        metadata.name,
        spec.clusterQueue,
      ]),
    ).toEqual([
      ["woodpecker-ci", "default", CI_CLUSTER_QUEUE],
      [
        "woodpecker-ci",
        CI_MAINTENANCE_LOCAL_QUEUE,
        CI_MAINTENANCE_CLUSTER_QUEUE,
      ],
    ]);
  });

  /** Woodpecker creates bare pods; without `pod`, Kueue admits nothing. */
  it("integrates plain pods as well as Jobs", () => {
    const application = synthKueueAppDocuments()
      .map((document) =>
        z
          .object({
            kind: z.literal("Application"),
            spec: z.object({
              source: z.object({
                helm: z.object({
                  valuesObject: z.object({
                    managerConfig: z.object({
                      controllerManagerConfigYaml: z.string(),
                    }),
                  }),
                }),
              }),
            }),
          })
          .safeParse(document),
      )
      .find((result) => result.success);
    if (application?.success !== true) {
      throw new Error("Kueue Application was not synthesized");
    }
    const config = z
      .object({ integrations: z.object({ frameworks: z.array(z.string()) }) })
      .parse(
        parseYaml(
          application.data.spec.source.helm.valuesObject.managerConfig
            .controllerManagerConfigYaml,
        ),
      );
    expect(config.integrations.frameworks).toEqual(["batch/job", "pod"]);
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
