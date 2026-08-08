import { describe, expect, it } from "bun:test";
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
      accessModes: z.tuple([z.literal("ReadWriteMany")]),
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
  const persistentVolumeClaims = resources.flatMap((manifest) => {
    const result = PersistentVolumeClaimSchema.safeParse(manifest);
    return result.success ? [result.data] : [];
  });
  return {
    application: ApplicationSchema.parse(application),
    hooks: HooksConfigMapSchema.parse(hooks),
    bunCacheGcConfigMap: BunCacheGcConfigMapSchema.parse(bunCacheGcConfigMap),
    persistentVolumeClaims,
    resources,
  };
}

describe("Buildkite application", () => {
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
});
