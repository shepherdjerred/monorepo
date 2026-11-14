import { describe, expect, test } from "vitest";
import { App, Chart } from "cdk8s";
import { z } from "zod";
import { createScoutDeployment } from "./index.ts";
import { ContainerEnvSchema } from "@shepherdjerred/homelab/cdk8s/src/testing/container-env-schema.ts";
import { resourcesFor } from "@shepherdjerred/homelab/cdk8s/src/scout-test-resources.ts";

const PodSchema = z.object({
  template: z.object({
    spec: z.object({
      containers: z.array(z.object({ env: ContainerEnvSchema })),
    }),
  }),
});

describe("Scout operations machine credential", () => {
  test.each(["beta", "prod"] as const)(
    "%s grants the required token only to the application role that serves the API",
    (stage) => {
      const app = new App();
      const chart = new Chart(app, `scout-${stage}`, {
        namespace: `scout-${stage}`,
        disableResourceNameHashes: true,
      });
      createScoutDeployment(chart, stage);
      const deployments = resourcesFor(app).filter(
        (resource) => resource.kind === "Deployment",
      );
      let applicationContainers = 0;
      for (const deployment of deployments) {
        const pod = PodSchema.parse(deployment.spec);
        for (const container of pod.template.spec.containers) {
          const token = container.env.filter(
            (entry) => entry.name === "SCOUT_OPERATIONS_TOKEN",
          );
          const role = container.env.find(
            (entry) => entry.name === "SCOUT_RUNTIME_ROLE",
          )?.value;
          if (role !== "application") {
            expect(token).toEqual([]);
            continue;
          }
          applicationContainers += 1;
          expect(token).toHaveLength(1);
          expect(token[0]?.value).toBeUndefined();
          expect(token[0]?.valueFrom?.secretKeyRef).toEqual({
            name: `scout-${stage}-scout-for-lol-1p`,
            key: "SCOUT_OPERATIONS_TOKEN",
          });
        }
      }
      expect(applicationContainers).toBe(1);
    },
  );
});
