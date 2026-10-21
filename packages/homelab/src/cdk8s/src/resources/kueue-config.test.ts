import { describe, expect, it } from "vitest";
import { App, Chart } from "cdk8s";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  CI_CLUSTER_QUEUE,
  CI_GATE_CLUSTER_QUEUE,
  CI_GATE_LOCAL_QUEUE,
  CI_MAINTENANCE_CLUSTER_QUEUE,
  CI_MAINTENANCE_LOCAL_QUEUE,
  DELIVERY_CLUSTER_QUEUE,
  createKueueConfig,
} from "@shepherdjerred/homelab/cdk8s/src/resources/kueue-config.ts";
import { createKueueApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/kueue.ts";
import { DELIVERY_STAGE_REQUESTS } from "homelab/src/delivery-stage-admission.ts";
import {
  CI_ADMISSION_BUDGET,
  CI_COMPUTE_WORKFLOWS,
  CI_GATE_WORKFLOWS,
} from "@shepherdjerred/homelab/cdk8s/src/misc/woodpecker.ts";

const ClusterQueueSchema = z.object({
  apiVersion: z.literal("kueue.x-k8s.io/v1beta2"),
  kind: z.literal("ClusterQueue"),
  metadata: z.object({ name: z.string() }).loose(),
  spec: z
    .object({
      namespaceSelector: z.object({
        matchLabels: z.record(z.string(), z.string()).optional(),
        matchExpressions: z
          .array(
            z.object({
              key: z.string(),
              operator: z.string(),
              values: z.array(z.string()),
            }),
          )
          .optional(),
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

const CLUSTER_QUEUES = [
  CI_CLUSTER_QUEUE,
  CI_GATE_CLUSTER_QUEUE,
  CI_MAINTENANCE_CLUSTER_QUEUE,
  DELIVERY_CLUSTER_QUEUE,
];

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
  it("disables Kueue readiness eviction for long-running CI", () => {
    const documents = synthKueueAppDocuments();
    const application = documents.find(
      (document) =>
        z
          .object({
            kind: z.literal("Application"),
            metadata: z.object({ name: z.literal("kueue") }).loose(),
          })
          .loose()
          .safeParse(document).success,
    );
    const config = z
      .object({
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
      .parse(application);
    const kueueConfig: unknown = parseYaml(
      config.spec.source.helm.valuesObject.managerConfig
        .controllerManagerConfigYaml,
    );
    expect(
      z
        .object({
          managedJobsNamespaceSelector: z.object({
            matchLabels: z.object({
              "kueue.x-k8s.io/managed-namespace": z.literal("true"),
            }),
          }),
          featureGates: z.object({
            DisableWaitForPodsReady: z.literal(true),
          }),
        })
        .parse(kueueConfig),
    ).toBeDefined();
  });

  it("covers pods and ephemeral-storage alongside cpu and memory", () => {
    // Every CI container requests ephemeral-storage, and Kueue refuses a
    // workload requesting a resource its ClusterQueue does not cover: if this
    // drifts, every build sits gated forever. Regression guard for the
    // 2026-07-24 freeze.
    for (const name of CLUSTER_QUEUES) {
      expect(
        clusterQueue(name).spec.resourceGroups[0]?.coveredResources,
      ).toEqual(["cpu", "memory", "pods", "ephemeral-storage"]);
    }
  });

  it("takes the CI budget from its language-neutral source", () => {
    expect(quota(CI_CLUSTER_QUEUE, "cpu")).toBe("23");
    expect(quota(CI_CLUSTER_QUEUE, "memory")).toBe("70Gi");
    expect(quota(CI_CLUSTER_QUEUE, "ephemeral-storage")).toBe("56Gi");
    expect(quota(CI_GATE_CLUSTER_QUEUE, "cpu")).toBe("1");
    expect(quota(CI_GATE_CLUSTER_QUEUE, "memory")).toBe("2Gi");
    expect(quota(CI_GATE_CLUSTER_QUEUE, "ephemeral-storage")).toBe("4Gi");
    expect(CI_ADMISSION_BUDGET.quota).toEqual({
      cpu: "24",
      memory: "72Gi",
      "ephemeral-storage": "60Gi",
    });
  });

  it("keeps every queue's memory plus buildkitd within liskov's allocatable memory", () => {
    // Kueue admits against each queue alone, so an admitted pod can still sit
    // unschedulable when the queues together exceed the node. liskov reports
    // about 91.5Gi allocatable, and buildkitd permanently requests 5Gi
    // (`resources/buildkitd.ts`).
    const LISKOV_ALLOCATABLE_GIB = 91.5;
    const BUILDKITD_REQUEST_GIB = 5;
    const queuedGib = CLUSTER_QUEUES.map((name) => {
      const memory = quota(name, "memory") ?? "";
      if (!/^\d+Gi$/u.test(memory)) {
        throw new Error(`${name} memory quota is not whole Gi: ${memory}`);
      }
      return Number.parseInt(memory, 10);
    }).reduce((total, gib) => total + gib, 0);
    expect(queuedGib + BUILDKITD_REQUEST_GIB).toBeLessThanOrEqual(
      LISKOV_ALLOCATABLE_GIB,
    );
  });

  /**
   * Counted in pods, not workflows: a workflow has its step and each of its
   * services admitted at once. Sized so the pods quota never binds before the
   * agent's workflow cap does.
   */
  it("sizes the pods backstop from the workflow cap and services", () => {
    const perWorkflow = 1 + CI_ADMISSION_BUDGET.maxServicesPerWorkflow;
    expect(quota(CI_CLUSTER_QUEUE, "pods")).toBe(
      String(CI_COMPUTE_WORKFLOWS * perWorkflow),
    );
    expect(quota(CI_GATE_CLUSTER_QUEUE, "pods")).toBe(
      String(CI_GATE_WORKFLOWS),
    );
    expect(CI_COMPUTE_WORKFLOWS).toBe(8);
    expect(CI_GATE_WORKFLOWS).toBe(4);
  });

  it("admits declared executor namespaces only on the compute queue, and never preempts", () => {
    for (const name of [
      CI_CLUSTER_QUEUE,
      CI_GATE_CLUSTER_QUEUE,
      CI_MAINTENANCE_CLUSTER_QUEUE,
    ]) {
      const { spec } = clusterQueue(name);
      expect(spec.namespaceSelector).toEqual(
        name === CI_CLUSTER_QUEUE
          ? {
              matchExpressions: [
                {
                  key: "kubernetes.io/metadata.name",
                  operator: "In",
                  values: [
                    "woodpecker-ci",
                    "delivery-worker-jobs",
                    "delivery-platform-jobs",
                  ],
                },
              ],
            }
          : { matchLabels: { "kubernetes.io/metadata.name": "woodpecker-ci" } },
      );
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
      ["woodpecker-ci", CI_GATE_LOCAL_QUEUE, CI_GATE_CLUSTER_QUEUE],
      [
        "woodpecker-ci",
        CI_MAINTENANCE_LOCAL_QUEUE,
        CI_MAINTENANCE_CLUSTER_QUEUE,
      ],
    ]);
  });

  /**
   * A waiting Delivery Job already outranked every CI pod, yet Kueue admits
   * smaller CI pods past a head that does not fit. Only quota CI cannot borrow
   * gives it precedence, and only quota outside CI's leaves CI's intact.
   */
  it("reserves exactly one Delivery stage Job beside the CI budget", () => {
    const { spec } = clusterQueue(DELIVERY_CLUSTER_QUEUE);
    expect(spec.namespaceSelector).toEqual({
      matchExpressions: [
        {
          key: "kubernetes.io/metadata.name",
          operator: "In",
          values: ["delivery-worker-jobs", "delivery-platform-jobs"],
        },
      ],
    });
    expect(spec.preemption).toEqual({
      withinClusterQueue: "Never",
      reclaimWithinCohort: "Never",
    });
    for (const [resource, request] of Object.entries({
      ...DELIVERY_STAGE_REQUESTS,
      pods: "1",
    })) {
      expect(quota(DELIVERY_CLUSTER_QUEUE, resource)).toBe(request);
    }
    // In a cohort, idle quota is lent away and, without preemption, is only
    // returned as the borrower finishes.
    for (const name of CLUSTER_QUEUES) {
      expect(clusterQueue(name).spec).not.toHaveProperty("cohortName");
    }
  });
});

describe("Kueue priority and controller integration", () => {
  it("defines independent admission priorities for main, ready PRs and drafts", () => {
    const PrioritySchema = z.object({
      kind: z.literal("WorkloadPriorityClass"),
      apiVersion: z.literal("kueue.x-k8s.io/v1beta2"),
      metadata: z.object({ name: z.string() }),
      value: z.number(),
    });
    const priorities = synthDocuments(createKueueConfig)
      .map((document) => PrioritySchema.safeParse(document))
      .filter((result) => result.success)
      .map((result) => [result.data.metadata.name, result.data.value]);
    expect(priorities).toEqual([
      ["ci-main", 300],
      ["ci-ready", 200],
      ["ci-draft", 100],
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

  it("scrapes Kueue through the one selected ServiceMonitor", () => {
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
                            enablePrometheus: z.literal(false),
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
