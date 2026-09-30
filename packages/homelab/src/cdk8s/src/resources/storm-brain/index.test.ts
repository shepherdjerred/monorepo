import { expect, test } from "vitest";
import { App, Chart, Testing } from "cdk8s";
import { z } from "zod";
import { createStormBrainDeployment } from "./index.ts";

const DeploymentSchema = z.object({
  kind: z.literal("Deployment"),
  metadata: z.object({ name: z.string() }).loose(),
  spec: z.object({
    template: z.object({
      spec: z.object({
        containers: z.array(
          z
            .object({
              name: z.string(),
              securityContext: z
                .object({
                  allowPrivilegeEscalation: z.literal(false),
                  capabilities: z.object({ drop: z.tuple([z.literal("ALL")]) }),
                  privileged: z.literal(false),
                  readOnlyRootFilesystem: z.literal(true),
                  runAsGroup: z.literal(1000),
                  runAsNonRoot: z.literal(true),
                  runAsUser: z.literal(1000),
                  seccompProfile: z.object({
                    type: z.literal("RuntimeDefault"),
                  }),
                })
                .loose(),
            })
            .loose(),
        ),
      }),
    }),
  }),
});

test("synthesizes authenticated brain, Flipt, and monitoring wiring", () => {
  const app = new App();
  const chart = new Chart(app, "test", {
    namespace: "storm-brain",
    disableResourceNameHashes: true,
  });
  createStormBrainDeployment(chart);
  const manifests = JSON.stringify(Testing.synth(chart));

  expect(manifests).toContain("STORM_BRAIN_BEARER_TOKEN");
  expect(manifests).toContain("OPENAI_API_KEY");
  expect(manifests).toContain("flipt-flipt-service.flipt.svc.cluster.local");
  expect(manifests).toContain("ServiceMonitor");
  expect(manifests).toContain('"readOnlyRootFilesystem":true');

  const deployment = Testing.synth(chart)
    .map((manifest) => DeploymentSchema.safeParse(manifest))
    .find((result) => result.success)?.data;
  if (deployment === undefined) {
    throw new Error("Missing Deployment/storm-brain manifest");
  }
});
