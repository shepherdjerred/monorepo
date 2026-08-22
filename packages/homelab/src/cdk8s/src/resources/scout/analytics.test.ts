import { describe, expect, test } from "vitest";
import { App, Chart, Testing } from "cdk8s";
import { z } from "zod";
import analyticsRegistryJson from "@shepherdjerred/monorepo/config/analytics-sites.json" with { type: "json" };
import { createScoutDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/scout/index.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { scoutImageUsesPostgres } from "@shepherdjerred/homelab/cdk8s/src/release-configuration.ts";

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
      createScoutDeployment(chart, stage);
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
      const imageVersion = versions[`shepherdjerred/scout-for-lol/${stage}`];
      if (scoutImageUsesPostgres(imageVersion)) {
        expect(env.get("DATABASE_URL")).toBe(
          `postgresql://$(DB_USER):$(DB_PASSWORD)@scout-${stage}-postgresql.scout-${stage}.svc.cluster.local:5432/scout`,
        );
      } else {
        expect(env.get("DATABASE_URL")).toBe("file:/data/db.sqlite");
      }
    },
  );

  test.each([
    [
      "2.0.0-9495@sha256:513c2c6ef457ee91b8a18ec2c6f999558617560f57b21cc70440e3ab833c0347",
      false,
    ],
    [
      "2.0.0-10659@sha256:19a093e214765d13cbb8c59c32b73b4220990e3d71361de83cd25b021b1539f1",
      true,
    ],
  ])("classifies the Scout database contract for %s", (version, expected) => {
    expect(scoutImageUsesPostgres(version)).toBe(expected);
  });
});
