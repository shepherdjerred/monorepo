import { describe, expect, test } from "vitest";
import { App, Chart, Testing } from "cdk8s";
import { z } from "zod";
import { createBirmelChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/birmel.ts";
import { createMediaChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/media.ts";
import { createScoutChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/scout.ts";
import { createStarlightKarmaBotChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/starlight-karma-bot.ts";
import { createTemporalChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/temporal.ts";
import { createTrmnlDashboardChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/trmnl-dashboard.ts";
import { createBuildkiteApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/buildkite.ts";

const ManifestSchema = z
  .object({
    kind: z.string(),
    metadata: z.object({ name: z.string() }).loose(),
    spec: z
      .object({
        template: z.object({
          spec: z.object({
            containers: z.array(
              z.object({
                env: z
                  .array(
                    z.object({
                      name: z.string(),
                      value: z.string().optional(),
                    }),
                  )
                  .optional(),
              }),
            ),
          }),
        }),
      })
      .optional(),
  })
  .loose();

async function fliptConsumers(
  createChart: (app: App) => void | Promise<void>,
): Promise<
  {
    name: string;
    environment: string | undefined;
    namespace: string | undefined;
  }[]
> {
  const app = new App();
  await createChart(app);
  return app.charts.flatMap((chart) =>
    z
      .array(z.unknown())
      .parse(Testing.synth(chart))
      .flatMap((manifest) => {
        const parsed = ManifestSchema.safeParse(manifest);
        if (!parsed.success || parsed.data.kind !== "Deployment") return [];
        return (parsed.data.spec?.template.spec.containers ?? []).flatMap(
          (container) => {
            const env = new Map(
              (container.env ?? []).map((entry) => [entry.name, entry.value]),
            );
            if (env.get("FEATURE_FLAGS_MODE") !== "flipt") return [];
            return [
              {
                name: parsed.data.metadata.name,
                environment: env.get("FLIPT_ENVIRONMENT"),
                namespace: env.get("FLIPT_NAMESPACE"),
              },
            ];
          },
        );
      }),
  );
}

describe("Flipt consumer environments", () => {
  const cases = [
    {
      name: "Scout beta",
      environment: "beta",
      namespace: "scout",
      count: 1,
      createChart: (app: App) => createScoutChart(app, "beta"),
    },
    {
      name: "Scout prod",
      environment: "prod",
      namespace: "scout",
      count: 1,
      createChart: (app: App) => createScoutChart(app, "prod"),
    },
    {
      name: "Karma beta",
      environment: "beta",
      namespace: "starlight-karma-bot",
      count: 1,
      createChart: (app: App) => createStarlightKarmaBotChart(app, "beta"),
    },
    {
      name: "Karma prod",
      environment: "prod",
      namespace: "starlight-karma-bot",
      count: 1,
      createChart: (app: App) => createStarlightKarmaBotChart(app, "prod"),
    },
    {
      name: "Birmel",
      environment: "prod",
      namespace: "birmel",
      count: 1,
      createChart: (app: App) => createBirmelChart(app),
    },
    {
      name: "Streambot",
      environment: "prod",
      namespace: "streambot",
      count: 1,
      createChart: (app: App) => createMediaChart(app),
    },
    {
      name: "TRMNL dashboard",
      environment: "prod",
      namespace: "trmnl-dashboard",
      count: 1,
      createChart: (app: App) => createTrmnlDashboardChart(app),
    },
    {
      name: "Temporal",
      environment: "prod",
      namespace: "temporal",
      count: 12,
      createChart: (app: App) => createTemporalChart(app),
    },
    {
      name: "Buildkite maintenance",
      environment: "prod",
      namespace: "temporal",
      count: 1,
      createChart: (app: App) => {
        const chart = new Chart(app, "buildkite-feature-flags", {
          disableResourceNameHashes: true,
        });
        createBuildkiteApp(chart);
      },
    },
  ];

  test.each(cases)(
    "sets $name to $environment/$namespace",
    async ({ environment, namespace, count, createChart }) => {
      const consumers = await fliptConsumers(createChart);
      expect(consumers).toHaveLength(count);
      for (const consumer of consumers) {
        expect(consumer.environment).toBe(environment);
        expect(consumer.namespace).toBe(namespace);
      }
    },
  );
});
