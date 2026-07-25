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

function synthBuildkiteApplication() {
  const chart = Testing.chart();
  createBuildkiteApp(chart);
  const application = z
    .array(z.unknown())
    .parse(Testing.synth(chart))
    .find((manifest) => ApplicationSchema.safeParse(manifest).success);
  return ApplicationSchema.parse(application);
}

describe("Buildkite application", () => {
  it("accounts for the tmpfs checkout on the checkout container", () => {
    const application = synthBuildkiteApplication();
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
});
