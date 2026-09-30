import { describe, expect, test } from "vitest";
import { App, Chart, Testing } from "cdk8s";
import { z } from "zod";
import analyticsRegistryJson from "@shepherdjerred/monorepo/config/analytics-sites.json" with { type: "json" };
import { createScoutDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/scout/index.ts";
import { SCOUT_GATEWAY_TOPOLOGY } from "@shepherdjerred/homelab/cdk8s/src/resources/scout/topology.ts";

const RegistrySchema = z.object({
  projectToken: z.string(),
  apiHost: z.string(),
  sites: z.array(z.object({ key: z.string(), hostname: z.string() })),
});

const DeploymentSchema = z.object({
  kind: z.literal("Deployment"),
  spec: z.object({
    template: z.object({
      spec: z.object({
        containers: z.array(
          z.object({
            env: z.array(
              z.object({ name: z.string(), value: z.string().optional() }),
            ),
          }),
        ),
      }),
    }),
  }),
});

describe("Scout PostHog deployment configuration", () => {
  test.each(["beta", "prod"] as const)(
    "synthesizes registry values for %s",
    (stage) => {
      const app = new App();
      const chart = new Chart(app, `scout-${stage}`, {
        namespace: `scout-${stage}`,
        disableResourceNameHashes: true,
      });
      createScoutDeployment(chart, stage, SCOUT_GATEWAY_TOPOLOGY[stage]);
      const manifests = z.array(z.unknown()).parse(Testing.synth(chart));
      const deployment = DeploymentSchema.parse(
        manifests.find((manifest) => {
          const kind = z.object({ kind: z.string() }).safeParse(manifest);
          return kind.success && kind.data.kind === "Deployment";
        }),
      );
      const env = new Map(
        deployment.spec.template.spec.containers[0]?.env.map((entry) => [
          entry.name,
          entry.value,
        ]),
      );
      const registry = RegistrySchema.parse(analyticsRegistryJson);
      const site = registry.sites.find(
        (candidate) => candidate.key === `scout-${stage}`,
      );

      expect(site).toBeDefined();
      expect(env.get("POSTHOG_PROJECT_TOKEN")).toBe(registry.projectToken);
      expect(env.get("POSTHOG_API_HOST")).toBe(registry.apiHost);
      expect(env.get("POSTHOG_SITE_KEY")).toBe(site?.key);
      expect(env.get("POSTHOG_SITE_HOSTNAME")).toBe(site?.hostname);
      // Scout is PostgreSQL-only in every stage: the SQLite fallback is gone.
      expect(env.get("DATABASE_URL")).toBe(
        `postgresql://$(DB_USER):$(DB_PASSWORD)@scout-${stage}-postgresql.scout-${stage}.svc.cluster.local:5432/scout`,
      );
    },
  );
});
