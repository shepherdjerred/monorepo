import { describe, expect, it } from "vitest";
import { App, Chart } from "cdk8s";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { createWoodpeckerChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/woodpecker.ts";
import { createStorageClasses } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/storage-classes.ts";
import {
  CI_BOUNDED_RESOURCES,
  CI_POD_GUARD_POLICY,
  createWoodpeckerCiPodGuard,
} from "@shepherdjerred/homelab/cdk8s/src/resources/woodpecker/ci-pod-guard.ts";

function documents(yamlContent: string): unknown[] {
  return yamlContent
    .split(/^---$/m)
    .map((document) => document.trim())
    .filter((document) => document.length > 0)
    .map((document) => parseYaml(document));
}

const ManifestSchema = z
  .object({
    kind: z.string(),
    metadata: z
      .object({
        name: z.string(),
        namespace: z.string().optional(),
        labels: z.record(z.string(), z.string()).optional(),
        annotations: z.record(z.string(), z.string()).optional(),
      })
      .loose(),
  })
  .loose();

type Manifest = z.infer<typeof ManifestSchema>;

function woodpeckerManifests(): Manifest[] {
  const app = new App({ outdir: ".test-synth-woodpecker-ci-namespace" });
  createWoodpeckerChart(app);
  return documents(app.synthYaml())
    .map((document) => ManifestSchema.safeParse(document))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);
}

function find(kind: string, name: string): Manifest {
  const found = woodpeckerManifests().find(
    (manifest) => manifest.kind === kind && manifest.metadata.name === name,
  );
  if (found === undefined) throw new Error(`${kind} ${name} not synthesized`);
  return found;
}

const EnvSchema = z.array(
  z.object({ name: z.string(), value: z.string().optional() }).loose(),
);

function agentEnvironment(): Map<string, string | undefined> {
  const deployment = z
    .object({
      spec: z.object({
        template: z.object({
          spec: z.object({
            containers: z.array(z.object({ env: EnvSchema }).loose()),
          }),
        }),
      }),
    })
    .parse(find("Deployment", "woodpecker-woodpecker-agent"));
  const container = deployment.spec.template.spec.containers[0];
  if (container === undefined) throw new Error("agent has no container");
  return new Map(container.env.map((entry) => [entry.name, entry.value]));
}

const PodTemplateSchema = z.object({
  metadata: z.object({ name: z.string(), namespace: z.string() }).loose(),
  spec: z.object({
    template: z.object({
      spec: z
        .object({
          nodeSelector: z.record(z.string(), z.string()).optional(),
          containers: z.array(
            z
              .object({
                resources: z
                  .object({
                    requests: z.record(z.string(), z.string()).optional(),
                    limits: z.record(z.string(), z.string()).optional(),
                  })
                  .optional(),
              })
              .loose(),
          ),
          initContainers: z
            .array(
              z
                .object({
                  resources: z
                    .object({
                      requests: z.record(z.string(), z.string()).optional(),
                      limits: z.record(z.string(), z.string()).optional(),
                    })
                    .optional(),
                })
                .loose(),
            )
            .optional(),
        })
        .loose(),
    }),
  }),
});

describe("Woodpecker CI namespace", () => {
  /**
   * Kueue's pod integration can only be scoped by namespace, and it gates
   * every pod in a managed one -- so the control plane must never carry the
   * label, or a Kueue outage would stop the server and agent restarting.
   */
  it("is Kueue-managed, and the control plane is not", () => {
    expect(find("Namespace", "woodpecker-ci").metadata.labels).toMatchObject({
      "kueue.x-k8s.io/managed-namespace": "true",
      "pod-security.kubernetes.io/enforce": "privileged",
    });
    expect(
      find("Namespace", "woodpecker").metadata.labels?.[
        "kueue.x-k8s.io/managed-namespace"
      ],
    ).toBeUndefined();
  });

  it("holds the CI work, and the control plane holds only the control plane", () => {
    const manifests = woodpeckerManifests();
    const deploymentsIn = (namespace: string) =>
      manifests
        .filter(
          (manifest) =>
            manifest.kind === "Deployment" &&
            manifest.metadata.namespace === namespace,
        )
        .map((manifest) => manifest.metadata.name)
        .sort();
    expect(deploymentsIn("woodpecker-ci")).toEqual([
      "temporal-maintenance-worker",
    ]);
    expect(deploymentsIn("woodpecker")).toEqual([
      "woodpecker-woodpecker-agent",
      "woodpecker-woodpecker-config-extension",
      "woodpecker-woodpecker-server",
    ]);
    for (const manifest of manifests) {
      if (
        manifest.kind === "PersistentVolumeClaim" ||
        (manifest.kind === "OnePasswordItem" &&
          manifest.metadata.name !== "woodpecker-server-credentials")
      ) {
        expect(manifest.metadata.namespace, manifest.metadata.name).toBe(
          "woodpecker-ci",
        );
      }
    }
  });

  /** The clone pod runs as `default`; no CI pod needs the Kubernetes API. */
  it("mounts no API token into pods that name no service account", () => {
    const account = z
      .object({
        metadata: z.object({ namespace: z.string() }).loose(),
        automountServiceAccountToken: z.boolean(),
      })
      .parse(
        woodpeckerManifests().find(
          (manifest) =>
            manifest.kind === "ServiceAccount" &&
            manifest.metadata.name === "default",
        ),
      );
    expect(account.metadata.namespace).toBe("woodpecker-ci");
    expect(account.automountServiceAccountToken).toBe(false);
  });

  it("gives the clone pod a budget, including ephemeral storage", () => {
    const limitRange = z
      .object({
        metadata: z.object({ namespace: z.string() }).loose(),
        spec: z.object({
          limits: z.array(
            z.object({
              type: z.literal("Container"),
              defaultRequest: z.record(z.string(), z.string()),
              default: z.record(z.string(), z.string()),
            }),
          ),
        }),
      })
      .parse(find("LimitRange", "woodpecker-ci-default-resources"));
    expect(limitRange.metadata.namespace).toBe("woodpecker-ci");
    for (const resource of CI_BOUNDED_RESOURCES) {
      expect(limitRange.spec.limits[0]?.defaultRequest[resource]).toBeDefined();
      expect(limitRange.spec.limits[0]?.default[resource]).toBeDefined();
    }
  });

  /**
   * The only settings that reach clone and service pods. Without the node
   * selector the clone lands on the production node and the workspace claim
   * binds there with it.
   */
  it("sends every agent-created pod to liskov at batch priority", () => {
    const env = agentEnvironment();
    expect(env.get("WOODPECKER_BACKEND_K8S_NAMESPACE")).toBe("woodpecker-ci");
    expect(
      JSON.parse(env.get("WOODPECKER_BACKEND_K8S_POD_NODE_SELECTOR") ?? ""),
    ).toEqual({ "kubernetes.io/hostname": "liskov" });
    expect(
      JSON.parse(env.get("WOODPECKER_BACKEND_K8S_POD_TOLERATIONS") ?? ""),
    ).toEqual([
      { key: "ci", operator: "Equal", value: "only", effect: "NoSchedule" },
    ]);
    expect(env.get("WOODPECKER_BACKEND_K8S_PRIORITY_CLASS")).toBe("batch-low");
    expect(env.get("WOODPECKER_BACKEND_K8S_STORAGE_CLASS")).toBe(
      "ci-workspace",
    );
  });

  /** Woodpecker creates a headless Service per workflow before any pod. */
  it("lets the agent create what a workflow needs, only in the CI namespace", () => {
    const role = z
      .object({
        metadata: z.object({ namespace: z.string() }).loose(),
        rules: z.array(
          z.object({
            resources: z.array(z.string()),
            verbs: z.array(z.string()),
          }),
        ),
      })
      .parse(find("Role", "woodpecker-agent"));
    expect(role.metadata.namespace).toBe("woodpecker-ci");
    const creatable = role.rules
      .filter((rule) => rule.verbs.includes("create"))
      .flatMap((rule) => rule.resources)
      .sort();
    expect(creatable).toEqual([
      "persistentvolumeclaims",
      "pods",
      "pods/log",
      "services",
    ]);
  });

  /**
   * Every long-running pod this chart puts in the CI namespace must pass the
   * same guard the agent's pods do, or it would never start.
   */
  it("only puts pods in the CI namespace that the pod guard admits", () => {
    const templates = woodpeckerManifests()
      .filter(
        (manifest) =>
          manifest.kind === "Deployment" &&
          manifest.metadata.namespace === "woodpecker-ci",
      )
      .map((manifest) => PodTemplateSchema.parse(manifest));
    expect(templates.length).toBeGreaterThan(0);
    for (const template of templates) {
      const { spec } = template.spec.template;
      expect(spec.nodeSelector, template.metadata.name).toEqual({
        "kubernetes.io/hostname": "liskov",
      });
      for (const container of [
        ...spec.containers,
        ...(spec.initContainers ?? []),
      ]) {
        for (const resource of CI_BOUNDED_RESOURCES) {
          expect(container.resources?.requests?.[resource]).toBeDefined();
          expect(container.resources?.limits?.[resource]).toBeDefined();
        }
      }
    }
  });
});

describe("CI workspace storage", () => {
  it("deletes each workspace with its claim, and only provisions on liskov", () => {
    const app = new App();
    createStorageClasses(new Chart(app, "storage"));
    const storageClass = documents(app.synthYaml())
      .map((document) =>
        z
          .object({
            kind: z.literal("StorageClass"),
            metadata: z.object({ name: z.literal("ci-workspace") }),
            reclaimPolicy: z.string(),
            volumeBindingMode: z.string(),
            allowedTopologies: z.array(z.unknown()),
          })
          .loose()
          .safeParse(document),
      )
      .find((result) => result.success);
    if (storageClass?.success !== true) {
      throw new Error("ci-workspace StorageClass not synthesized");
    }
    expect(storageClass.data.reclaimPolicy).toBe("Delete");
    expect(storageClass.data.volumeBindingMode).toBe("WaitForFirstConsumer");
    expect(storageClass.data.allowedTopologies).toEqual([
      {
        matchLabelExpressions: [
          { key: "kubernetes.io/hostname", values: ["liskov"] },
        ],
      },
    ]);
  });
});

function guard() {
  const app = new App();
  createWoodpeckerCiPodGuard(new Chart(app, "guard"));
  const manifests = documents(app.synthYaml());
  const policy = manifests
    .map((document) =>
      z
        .object({
          kind: z.literal("ValidatingAdmissionPolicy"),
          metadata: z
            .object({
              name: z.string(),
              namespace: z.string().optional(),
              annotations: z.record(z.string(), z.string()),
            })
            .loose(),
          spec: z.object({
            failurePolicy: z.literal("Fail"),
            matchConstraints: z.object({
              namespaceSelector: z.object({
                matchLabels: z.record(z.string(), z.string()),
              }),
              resourceRules: z.array(
                z.object({
                  resources: z.array(z.string()),
                  operations: z.array(z.string()),
                }),
              ),
            }),
            validations: z.array(
              z.object({ expression: z.string(), message: z.string() }),
            ),
          }),
        })
        .safeParse(document),
    )
    .find((result) => result.success);
  const binding = manifests
    .map((document) =>
      z
        .object({
          kind: z.literal("ValidatingAdmissionPolicyBinding"),
          spec: z.object({
            policyName: z.string(),
            validationActions: z.array(z.string()),
          }),
        })
        .safeParse(document),
    )
    .find((result) => result.success);
  if (policy?.success !== true || binding?.success !== true) {
    throw new Error("pod guard not synthesized");
  }
  return { policy: policy.data, binding: binding.data };
}

describe("CI pod guard", () => {
  it("denies, fail-closed, pod creation in the CI namespace only", () => {
    const { policy, binding } = guard();
    expect(policy.metadata.name).toBe(CI_POD_GUARD_POLICY);
    // Cluster-scoped: must not inherit a chart namespace.
    expect(policy.metadata.namespace).toBeUndefined();
    expect(policy.spec.matchConstraints.namespaceSelector.matchLabels).toEqual({
      "kubernetes.io/metadata.name": "woodpecker-ci",
    });
    expect(policy.spec.matchConstraints.resourceRules).toEqual([
      expect.objectContaining({ resources: ["pods"], operations: ["CREATE"] }),
    ]);
    expect(binding.spec).toEqual({
      policyName: CI_POD_GUARD_POLICY,
      validationActions: ["Deny"],
    });
  });

  it("requires the CI node, batch priority, and bounded containers", () => {
    const expressions = guard().policy.spec.validations.map(
      (validation) => validation.expression,
    );
    expect(expressions).toHaveLength(4);
    expect(expressions[0]).toContain(
      "object.spec.nodeSelector['kubernetes.io/hostname'] == 'liskov'",
    );
    expect(expressions[1]).toContain(
      "'woodpecker-ci.org/task-uuid' in object.metadata.labels",
    );
    expect(expressions[1]).toContain(
      "object.spec.priorityClassName == 'batch-low'",
    );
    for (const expression of expressions.slice(2)) {
      for (const resource of CI_BOUNDED_RESOURCES) {
        expect(expression).toContain(`'${resource}'`);
      }
      expect(expression).toContain("r in c.resources.requests");
      expect(expression).toContain("r in c.resources.limits");
    }
    expect(expressions[3]).toMatch(
      /^!has\(object\.spec\.initContainers\) \|\| /u,
    );
  });

  it("lands before workloads, with the other admission policies", () => {
    expect(guard().policy.metadata.annotations).toEqual({
      "argocd.argoproj.io/sync-wave": "-30",
    });
  });
});
