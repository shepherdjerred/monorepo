import { describe, expect, it } from "bun:test";
import { Testing } from "cdk8s";
import { z } from "zod";
import { createBuildkiteApp } from "./buildkite.ts";

const ResourceRequirementsSchema = z.object({
  requests: z.object({
    cpu: z.string(),
    memory: z.string(),
  }),
  limits: z.object({
    cpu: z.string(),
    memory: z.string(),
  }),
});

const ApplicationSchema = z
  .object({
    kind: z.literal("Application"),
    metadata: z.object({
      name: z.literal("buildkite"),
    }),
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
                containers: z.array(
                  z.object({
                    name: z.string(),
                    resources: ResourceRequirementsSchema.optional(),
                  }),
                ),
              }),
            }),
          }),
        }),
      }),
    }),
  })
  .loose();

const ConfigMapSchema = z
  .object({
    apiVersion: z.literal("v1"),
    kind: z.literal("ConfigMap"),
    metadata: z.object({
      name: z.literal("buildkite-agent-hooks"),
      namespace: z.literal("buildkite"),
    }),
    data: z.object({
      "agent-shutdown": z.string(),
    }),
  })
  .loose();

const CachePruneCronJobSchema = z
  .object({
    kind: z.literal("CronJob"),
    metadata: z.object({
      name: z.literal("buildkite-uv-cache-prune"),
    }),
    spec: z.object({
      jobTemplate: z.object({
        spec: z.object({
          template: z.object({
            spec: z.object({
              containers: z.array(
                z.object({
                  name: z.string(),
                  image: z.string(),
                  imagePullPolicy: z.string().optional(),
                }),
              ),
            }),
          }),
        }),
      }),
    }),
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
    (manifest) => ConfigMapSchema.safeParse(manifest).success,
  );
  const cachePruneCronJob = resources.find(
    (manifest) => CachePruneCronJobSchema.safeParse(manifest).success,
  );
  return {
    application: ApplicationSchema.parse(application),
    hooks: ConfigMapSchema.parse(hooks),
    cachePruneCronJob: CachePruneCronJobSchema.parse(cachePruneCronJob),
  };
}

describe("Buildkite application", () => {
  it("accounts for the tmpfs checkout on the checkout container", () => {
    const { application } = synthBuildkiteResources();
    const containers =
      application.spec.source.helm.valuesObject.config["pod-spec-patch"]
        .containers;

    expect(containers).toContainEqual({
      name: "checkout",
      resources: {
        requests: { cpu: "50m", memory: "1Gi" },
        limits: { cpu: "400m", memory: "2Gi" },
      },
    });
    expect(containers).toContainEqual({
      name: "agent",
      resources: {
        requests: { cpu: "50m", memory: "64Mi" },
        limits: { cpu: "400m", memory: "768Mi" },
      },
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

  it("pins cache pruning to the promoted immutable ci-base image", async () => {
    const { cachePruneCronJob } = synthBuildkiteResources();
    const digestContents = await Bun.file(
      new URL("ci-base.DIGEST", import.meta.url),
    ).text();
    const digest = digestContents.trim();
    const container =
      cachePruneCronJob.spec.jobTemplate.spec.template.spec.containers.find(
        (candidate) => candidate.name === "uv-cache-prune",
      );

    expect(container).toEqual(
      expect.objectContaining({
        image: `ghcr.io/shepherdjerred/ci-base@${digest}`,
        imagePullPolicy: "IfNotPresent",
      }),
    );
    expect(container?.image).toMatch(
      /^ghcr\.io\/shepherdjerred\/ci-base@sha256:[\da-f]{64}$/,
    );
  });
});
