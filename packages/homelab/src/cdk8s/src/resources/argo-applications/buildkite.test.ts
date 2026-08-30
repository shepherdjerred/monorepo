import { describe, expect, it } from "vitest";
import { Testing } from "cdk8s";
import { z } from "zod";
import { createBuildkiteApp } from "./buildkite.ts";

const ApplicationSchema = z
  .object({
    kind: z.literal("Application"),
    metadata: z.object({ name: z.literal("buildkite") }),
    spec: z.object({
      source: z.object({
        helm: z.object({
          valuesObject: z.object({
            config: z.object({
              "max-in-flight": z.literal(24),
              "agent-config": z.object({
                "hooks-path": z.string(),
                hooksVolume: z.object({
                  name: z.string(),
                  configMap: z.object({
                    name: z.string(),
                    defaultMode: z.number().int(),
                  }),
                }),
              }),
              "pod-spec-patch": z.object({
                serviceAccountName: z.literal("buildkite-job"),
                automountServiceAccountToken: z.literal(false),
                volumes: z.array(
                  z.object({
                    name: z.string(),
                    persistentVolumeClaim: z.object({ claimName: z.string() }),
                  }),
                ),
                containers: z.array(z.object({ name: z.string() }).loose()),
              }),
            }),
          }),
        }),
      }),
    }),
  })
  .loose();

const PersistentVolumeClaimSchema = z
  .object({
    kind: z.literal("PersistentVolumeClaim"),
    metadata: z.object({
      name: z.string(),
      namespace: z.literal("buildkite"),
      labels: z.object({
        "velero.io/backup": z.literal("disabled"),
        "velero.io/exclude-from-backup": z.literal("true"),
      }),
    }),
    spec: z.object({
      accessModes: z.tuple([
        z.union([z.literal("ReadWriteMany"), z.literal("ReadWriteOnce")]),
      ]),
      storageClassName: z.string().optional(),
      resources: z.object({ requests: z.object({ storage: z.string() }) }),
    }),
  })
  .loose();

const HooksConfigMapSchema = z
  .object({
    apiVersion: z.literal("v1"),
    kind: z.literal("ConfigMap"),
    metadata: z.object({
      name: z.literal("buildkite-agent-hooks"),
      namespace: z.literal("buildkite"),
    }),
    data: z.object({ "agent-shutdown": z.string() }),
  })
  .loose();

const BunCacheGcConfigMapSchema = z
  .object({
    kind: z.literal("ConfigMap"),
    metadata: z.object({ name: z.literal("buildkite-bun-cache-gc") }),
    data: z.object({ "bun-cache-gc.sh": z.string() }),
  })
  .loose();

const TempoConfigMapSchema = z
  .object({
    kind: z.literal("ConfigMap"),
    metadata: z.object({
      name: z.literal("llm-observability-e2e-tempo"),
      namespace: z.literal("buildkite"),
    }),
    data: z.object({ "tempo.yaml": z.string() }),
  })
  .loose();

const PostHogTofuCredentialsSchema = z
  .object({
    apiVersion: z.literal("onepassword.com/v1"),
    kind: z.literal("OnePasswordItem"),
    metadata: z.object({
      name: z.literal("posthog-tofu-credentials"),
      namespace: z.literal("buildkite"),
    }),
    spec: z.object({
      itemPath: z.literal(
        "vaults/v64ocnykdqju4ui6j6pua56xw4/items/yh3xvqemmr4ic2up5zluo2rkcq",
      ),
    }),
  })
  .loose();

const CredentialItemSchema = z
  .object({
    apiVersion: z.literal("onepassword.com/v1"),
    kind: z.literal("OnePasswordItem"),
    metadata: z.object({
      name: z.string(),
      namespace: z.literal("buildkite"),
    }),
    spec: z.object({ itemPath: z.string() }),
  })
  .loose();

const JobServiceAccountSchema = z
  .object({
    apiVersion: z.literal("v1"),
    kind: z.literal("ServiceAccount"),
    metadata: z.object({
      name: z.literal("buildkite-job"),
      namespace: z.literal("buildkite"),
    }),
    automountServiceAccountToken: z.literal(false),
  })
  .loose();

const EXPECTED_CREDENTIAL_SECRET_NAMES = [
  "buildkite-github-credentials",
  "buildkite-api-credentials",
  "buildkite-analytics-credentials",
  "buildkite-turbo-cache-credentials",
  "buildkite-npm-credentials",
  "buildkite-claude-credentials",
  "buildkite-chartmuseum-credentials",
  "buildkite-argocd-credentials",
  "buildkite-seaweedfs-credentials",
  "buildkite-cloudflare-credentials",
  "buildkite-tailscale-credentials",
  "buildkite-arr-credentials",
  "discord-birmel-credentials",
  "discord-starlight-beta-credentials",
  "discord-starlight-prod-credentials",
  "discord-scout-beta-credentials",
  "discord-scout-prod-credentials",
  "discord-minecraft-credentials",
];

function synthBuildkiteResources() {
  const chart = Testing.chart();
  createBuildkiteApp(chart);
  const resources = z.array(z.unknown()).parse(Testing.synth(chart));
  const application = resources.find(
    (manifest) => ApplicationSchema.safeParse(manifest).success,
  );
  const hooks = resources.find(
    (manifest) => HooksConfigMapSchema.safeParse(manifest).success,
  );
  const bunCacheGcConfigMap = resources.find(
    (manifest) => BunCacheGcConfigMapSchema.safeParse(manifest).success,
  );
  const tempoConfigMap = resources.find(
    (manifest) => TempoConfigMapSchema.safeParse(manifest).success,
  );
  const persistentVolumeClaims = resources.flatMap((manifest) => {
    const result = PersistentVolumeClaimSchema.safeParse(manifest);
    return result.success ? [result.data] : [];
  });
  return {
    application: ApplicationSchema.parse(application),
    hooks: HooksConfigMapSchema.parse(hooks),
    bunCacheGcConfigMap: BunCacheGcConfigMapSchema.parse(bunCacheGcConfigMap),
    tempoConfigMap: TempoConfigMapSchema.parse(tempoConfigMap),
    persistentVolumeClaims,
    resources,
  };
}

function maintenanceDeployment(resources: readonly unknown[]) {
  const deployment = resources.find((manifest) => {
    const result = z
      .object({
        kind: z.literal("Deployment"),
        metadata: z.object({
          name: z.literal("temporal-maintenance-worker"),
          namespace: z.literal("buildkite"),
        }),
      })
      .safeParse(manifest);
    return result.success;
  });
  return z
    .object({
      kind: z.literal("Deployment"),
      metadata: z.object({
        name: z.literal("temporal-maintenance-worker"),
        namespace: z.literal("buildkite"),
      }),
      spec: z.object({
        replicas: z.union([z.literal(0), z.literal(1)]),
        strategy: z.object({ type: z.literal("Recreate") }),
        template: z.object({
          metadata: z.object({
            labels: z.object({ app: z.literal("temporal-maintenance-worker") }),
          }),
          spec: z.object({
            automountServiceAccountToken: z.literal(false),
            securityContext: z.object({
              fsGroup: z.literal(1000),
              fsGroupChangePolicy: z.literal("OnRootMismatch"),
            }),
            affinity: z.object({
              nodeAffinity: z.object({
                requiredDuringSchedulingIgnoredDuringExecution: z.object({
                  nodeSelectorTerms: z.array(
                    z.object({
                      matchExpressions: z.array(
                        z.object({
                          key: z.literal("kubernetes.io/hostname"),
                          values: z.tuple([z.literal("liskov")]),
                        }),
                      ),
                    }),
                  ),
                }),
              }),
            }),
            tolerations: z.array(
              z.object({
                key: z.literal("ci"),
                value: z.literal("only"),
                effect: z.literal("NoSchedule"),
              }),
            ),
            initContainers: z
              .array(
                z
                  .object({
                    name: z.string(),
                    volumeMounts: z.array(z.unknown()),
                  })
                  .loose(),
              )
              .optional(),
            containers: z.array(
              z.object({
                env: z.array(z.unknown()),
                volumeMounts: z.array(
                  z.object({ mountPath: z.string() }).loose(),
                ),
              }),
            ),
            volumes: z.array(z.object({ name: z.string() }).loose()),
          }),
        }),
      }),
    })
    .parse(deployment);
}

it("uses the Tempo 3 configuration schema for the E2E sidecar", () => {
  const { tempoConfigMap } = synthBuildkiteResources();
  const tempoConfig = tempoConfigMap.data["tempo.yaml"];

  expect(tempoConfig).toContain("distributor:");
  expect(tempoConfig).toContain("storage:");
  expect(tempoConfig).not.toMatch(/^(?:ingester|compactor):/mu);
});

it("syncs the dedicated PostHog OpenTofu credentials", () => {
  const { resources } = synthBuildkiteResources();
  expect(
    resources.some(
      (manifest) => PostHogTofuCredentialsSchema.safeParse(manifest).success,
    ),
  ).toBe(true);
});

it("syncs one Buildkite Secret per credential rotation boundary", () => {
  const { resources } = synthBuildkiteResources();
  const items = resources.flatMap((manifest) => {
    const result = CredentialItemSchema.safeParse(manifest);
    return result.success &&
      EXPECTED_CREDENTIAL_SECRET_NAMES.includes(result.data.metadata.name)
      ? [result.data]
      : [];
  });

  expect(items).toHaveLength(EXPECTED_CREDENTIAL_SECRET_NAMES.length);
  expect(items.map((item) => item.metadata.name).sort()).toEqual(
    EXPECTED_CREDENTIAL_SECRET_NAMES.toSorted(),
  );
  for (const item of items) {
    expect(item.metadata.namespace).toBe("buildkite");
    expect(item.spec.itemPath).toMatch(
      /^vaults\/v64ocnykdqju4ui6j6pua56xw4\/items\/[a-z0-9]{26}$/,
    );
  }
});

it("does not render the legacy aggregate CI Secret", () => {
  const { resources } = synthBuildkiteResources();
  expect(
    resources.some((manifest) => {
      const result = CredentialItemSchema.safeParse(manifest);
      return (
        result.success && result.data.metadata.name === "buildkite-ci-secrets"
      );
    }),
  ).toBe(false);
});

it("provisions a tokenless service account for Buildkite jobs", () => {
  const { resources } = synthBuildkiteResources();
  expect(
    resources.some(
      (manifest) => JobServiceAccountSchema.safeParse(manifest).success,
    ),
  ).toBe(true);
});

describe("Buildkite application", () => {
  it("raises the controller concurrency cap to 24", () => {
    const { application } = synthBuildkiteResources();
    expect(
      application.spec.source.helm.valuesObject.config["max-in-flight"],
    ).toBe(24);
  });

  it("accounts for the tmpfs checkout on the checkout container", () => {
    const { application } = synthBuildkiteResources();
    const containers =
      application.spec.source.helm.valuesObject.config["pod-spec-patch"]
        .containers;

    expect(containers).toContainEqual(
      expect.objectContaining({
        name: "checkout",
        resources: {
          requests: { cpu: "50m", memory: "1Gi" },
          limits: { cpu: "400m", memory: "2Gi" },
        },
      }),
    );
    expect(containers).toContainEqual(
      expect.objectContaining({
        name: "agent",
        resources: {
          requests: { cpu: "50m", memory: "64Mi" },
          limits: { cpu: "400m", memory: "768Mi" },
        },
      }),
    );
  });

  it("renders separate disposable Bun data and control volumes", () => {
    const { application, persistentVolumeClaims } = synthBuildkiteResources();
    const podSpecPatch =
      application.spec.source.helm.valuesObject.config["pod-spec-patch"];

    expect(persistentVolumeClaims).toContainEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({ name: "buildkite-bun-cache" }),
        spec: expect.objectContaining({
          accessModes: ["ReadWriteMany"],
          resources: { requests: { storage: "60Gi" } },
        }),
      }),
    );
    expect(persistentVolumeClaims).toContainEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          name: "buildkite-bun-cache-control",
        }),
        spec: expect.objectContaining({
          accessModes: ["ReadWriteMany"],
          resources: { requests: { storage: "1Gi" } },
        }),
      }),
    );
    expect(podSpecPatch.volumes).toContainEqual({
      name: "buildkite-bun-cache-control",
      persistentVolumeClaim: { claimName: "buildkite-bun-cache-control" },
    });
  });

  it("retains the agent for terminal cAdvisor scrapes after job finish", () => {
    const { application, hooks } = synthBuildkiteResources();
    const agentConfig =
      application.spec.source.helm.valuesObject.config["agent-config"];

    expect(agentConfig).toEqual({
      "hooks-path": "/buildkite/hooks",
      hooksVolume: {
        name: "buildkite-hooks",
        configMap: {
          name: "buildkite-agent-hooks",
          defaultMode: 493,
        },
      },
    });
    expect(hooks.data["agent-shutdown"]).toContain("#!/bin/sh");
    expect(hooks.data["agent-shutdown"]).toContain("set -eu");
    expect(hooks.data["agent-shutdown"]).toContain("sleep 20");
  });

  it("leaves recurring maintenance scheduling to Temporal", () => {
    const { resources, bunCacheGcConfigMap } = synthBuildkiteResources();
    const cronJobs = resources.filter((manifest) => {
      const resource = z.object({ kind: z.string() }).safeParse(manifest);
      return resource.success && resource.data.kind === "CronJob";
    });

    expect(cronJobs).toHaveLength(0);
    expect(bunCacheGcConfigMap.data["bun-cache-gc.sh"]).toContain(
      "flock --exclusive 9",
    );
    expect(bunCacheGcConfigMap.data["bun-cache-gc.sh"]).toContain(
      'find "$CACHE_DIR" -mindepth 1 -depth -delete',
    );
  });

  it("deploys one serial maintenance worker with all maintenance mounts", () => {
    const { resources } = synthBuildkiteResources();
    const deployment = maintenanceDeployment(resources);
    const container = deployment.spec.template.spec.containers[0];
    if (container === undefined) {
      throw new Error("maintenance worker container is missing");
    }
    expect(deployment.spec.replicas).toBe(1);
    const envNames = container.env.flatMap((entry) => {
      const parsed = z.object({ name: z.string() }).safeParse(entry);
      return parsed.success ? [parsed.data.name] : [];
    });
    expect(envNames).toContain("TEMPORAL_WORKER_ROLE");
    expect(envNames).toContain("KOMETA_PLEXTOKEN_FILE");
    expect(envNames).toContain("KOMETA_TMDBAPIKEY_FILE");
    expect(envNames).toContain("TURBO_CACHE_TOKEN_FILE");
    expect(container.env).toContainEqual({
      name: "TEMPORAL_ADDRESS",
      value: "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
    });
    expect(container.volumeMounts.map((mount) => mount.mountPath)).toEqual(
      expect.arrayContaining([
        "/buildkite/bun-cache",
        "/buildkite/bun-cache-control",
        "/buildkite/uv-cache",
        "/buildkite/trivy-db",
        "/buildkite/maintenance",
        "/etc/kometa",
        "/run/secrets/turbo-cache",
      ]),
    );
    expect(container.volumeMounts).toContainEqual(
      expect.objectContaining({
        mountPath: "/etc/kometa",
      }),
    );
    expect(deployment.spec.template.spec.initContainers).toContainEqual(
      expect.objectContaining({
        name: "copy-kometa-config",
        volumeMounts: expect.arrayContaining([
          expect.objectContaining({
            mountPath: "/etc/kometa-config",
            readOnly: true,
          }),
          expect.objectContaining({ mountPath: "/etc/kometa" }),
        ]),
      }),
    );
    expect(deployment.spec.template.spec.volumes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "pvc-buildkite-bun-cache" }),
        expect.objectContaining({ name: "pvc-buildkite-bun-cache-control" }),
        expect.objectContaining({ name: "pvc-buildkite-uv-cache" }),
        expect.objectContaining({ name: "pvc-buildkite-trivy-db" }),
        expect.objectContaining({ name: "configmap-buildkite-bun-cache-gc" }),
        expect.objectContaining({
          name: "configmap-temporal-maintenance-kometa-config",
        }),
        expect.objectContaining({
          name: "kometa-state",
          emptyDir: expect.any(Object),
        }),
        expect.objectContaining({
          secret: expect.objectContaining({
            secretName: "buildkite-turbo-cache-credentials",
          }),
        }),
      ]),
    );

    const serviceNames = resources.flatMap((manifest) => {
      const parsed = z
        .object({
          kind: z.literal("Service"),
          metadata: z.object({ name: z.string(), namespace: z.string() }),
        })
        .safeParse(manifest);
      return parsed.success && parsed.data.metadata.namespace === "buildkite"
        ? [parsed.data.metadata.name]
        : [];
    });
    expect(serviceNames).toEqual(
      expect.arrayContaining([
        "temporal-maintenance-worker-metrics",
        "temporal-maintenance-worker-app-metrics",
      ]),
    );
    const serviceMonitorNames = resources.flatMap((manifest) => {
      const parsed = z
        .object({
          kind: z.literal("ServiceMonitor"),
          metadata: z.object({ name: z.string(), namespace: z.string() }),
        })
        .safeParse(manifest);
      return parsed.success && parsed.data.metadata.namespace === "buildkite"
        ? [parsed.data.metadata.name]
        : [];
    });
    expect(serviceMonitorNames).toEqual(
      expect.arrayContaining([
        "temporal-maintenance-worker-metrics-service-monitor",
        "temporal-maintenance-worker-app-metrics-service-monitor",
      ]),
    );
  });
});

it("provisions an isolated, non-backed-up Codex auth volume", () => {
  const { persistentVolumeClaims } = synthBuildkiteResources();

  expect(persistentVolumeClaims).toContainEqual(
    expect.objectContaining({
      metadata: expect.objectContaining({ name: "buildkite-codex-auth" }),
      spec: expect.objectContaining({
        accessModes: ["ReadWriteOnce"],
        storageClassName: "zfs-ssd-lz4",
        resources: { requests: { storage: "1Gi" } },
      }),
    }),
  );
});
