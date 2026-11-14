import { App, Chart } from "cdk8s";
import { z } from "zod";
import { createScoutDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/scout/index.ts";
import { ContainerEnvSchema } from "@shepherdjerred/homelab/cdk8s/src/testing/container-env-schema.ts";
import { resourcesFor } from "@shepherdjerred/homelab/cdk8s/src/scout-test-resources.ts";

const PodSchema = z.object({
  template: z.object({
    spec: z.object({
      containers: z.array(z.object({ env: ContainerEnvSchema })),
    }),
  }),
});

export type ScoutContainerEnv = z.infer<
  typeof PodSchema
>["template"]["spec"]["containers"][number]["env"];

export type ScoutRoleContainer = {
  /** The container's `SCOUT_RUNTIME_ROLE`, when it declares one. */
  role: string | undefined;
  env: ScoutContainerEnv;
};

/** Synthesize one Scout stage and return every Deployment container with its runtime role. */
export function scoutRoleContainers(
  stage: "beta" | "prod",
  options?: Parameters<typeof createScoutDeployment>[2],
): ScoutRoleContainer[] {
  const app = new App();
  const chart = new Chart(app, `scout-${stage}`, {
    namespace: `scout-${stage}`,
    disableResourceNameHashes: true,
  });
  createScoutDeployment(chart, stage, options);
  return resourcesFor(app)
    .filter((resource) => resource.kind === "Deployment")
    .flatMap((deployment) =>
      PodSchema.parse(deployment.spec).template.spec.containers.map(
        (container) => ({
          role: container.env.find(
            (entry) => entry.name === "SCOUT_RUNTIME_ROLE",
          )?.value,
          env: container.env,
        }),
      ),
    );
}
