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

describe("Riot credential bootstrap", () => {
  test.each(["beta", "prod"] as const)(
    "%s grants required credentials only to the web application when provisioned",
    (stage) => {
      const app = new App();
      const chart = new Chart(app, `scout-${stage}`, {
        namespace: `scout-${stage}`,
        disableResourceNameHashes: true,
      });
      createScoutDeployment(chart, stage, { riotSignOnProvisioned: true });
      const deployments = resourcesFor(app).filter(
        (resource) => resource.kind === "Deployment",
      );
      for (const deployment of deployments) {
        const pod = PodSchema.parse(deployment.spec);
        for (const container of pod.template.spec.containers) {
          const credentials = container.env.filter((entry) =>
            entry.name.startsWith("RIOT_RSO_"),
          );
          const role = container.env.find(
            (entry) => entry.name === "SCOUT_RUNTIME_ROLE",
          )?.value;
          if (role !== "application") {
            expect(credentials).toEqual([]);
            continue;
          }
          expect(credentials.map((entry) => entry.name).sort()).toEqual([
            "RIOT_RSO_CLIENT_ID",
            "RIOT_RSO_CLIENT_SECRET",
          ]);
          for (const credential of credentials) {
            expect(credential.value).toBeUndefined();
            expect(credential.valueFrom?.secretKeyRef).toEqual({
              name: `scout-${stage}-scout-for-lol-1p`,
              key: credential.name,
            });
          }
        }
      }
    },
  );
  test("unprovisioned stages emit no references to missing credential fields", () => {
    const app = new App();
    createScoutDeployment(
      new Chart(app, "scout-beta", { namespace: "scout-beta" }),
      "beta",
      { riotSignOnProvisioned: false },
    );
    expect(app.synthYaml()).not.toContain("RIOT_RSO_CLIENT");
  });
});
