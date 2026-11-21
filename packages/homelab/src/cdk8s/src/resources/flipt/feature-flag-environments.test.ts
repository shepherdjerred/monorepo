import { describe, expect, test } from "vitest";
import { App, Chart, Testing } from "cdk8s";
import { z } from "zod";
import {
  flagDeploymentForSelector,
  flagDeployments,
} from "@shepherdjerred/feature-flags/deployments.ts";
import { createArcadeChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/games/arcade.ts";
import { createBirmelChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/birmel.ts";
import { createMediaChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/media/media.ts";
import { createScoutChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/scout.ts";
import { createStarlightKarmaBotChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/starlight-karma-bot.ts";
import { createStormBrainChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/storm-brain.ts";
import { createDeliveryChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/delivery.ts";
import { createTemporalChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/temporal.ts";
import { createTrackerChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/tracker.ts";
import { createWoodpeckerChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/woodpecker.ts";
import { createTrmnlDashboardChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/trmnl-dashboard.ts";
import { createAlertDashboardChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/alert-dashboard.ts";
import { deliveryActivation } from "@shepherdjerred/homelab/cdk8s/src/resources/delivery/activation.ts";
import { createMinecraftTsmcApp } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/games/minecraft-tsmc.ts";
import { createStormForumCharts } from "@shepherdjerred/homelab/cdk8s/src/resources/storm-forum/releases.ts";

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
        if (
          !parsed.success ||
          (parsed.data.kind !== "Deployment" &&
            parsed.data.kind !== "StatefulSet")
        ) {
          return [];
        }
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
      // Application, gateway and activity worker all evaluate the
      // same beta/scout flags from separate pods.
      count: 3,
      createChart: (app: App) => createScoutChart(app, "beta"),
    },
    {
      name: "Scout prod",
      environment: "prod",
      namespace: "scout",
      // Application, gateway and activity worker share prod/scout.
      count: 3,
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
      name: "Hub",
      environment: "prod",
      namespace: "alert-dashboard",
      count: 1,
      createChart: (app: App) => {
        createAlertDashboardChart(app);
      },
    },
    {
      name: "Temporal",
      environment: "prod",
      namespace: "temporal",
      count: 11,
      createChart: (app: App) => createTemporalChart(app),
    },
  ];

  test.each(cases)(
    "sets $name to $environment/$namespace",
    async ({ name, environment, namespace, count, createChart }) => {
      const consumers = await fliptConsumers(createChart);
      expect(consumers).toHaveLength(count);
      for (const consumer of consumers) {
        const gateway =
          name === "Temporal" && consumer.name === "temporal-temporal-gateway";
        expect(consumer.environment).toBe(gateway ? "beta" : environment);
        expect(consumer.namespace).toBe(namespace);
        // The gateway still reads the beta temporal document. That read is
        // not a deployment; every other selector is one.
        if (gateway) {
          expect(
            flagDeploymentForSelector(
              consumer.namespace ?? "",
              consumer.environment ?? "",
            ),
          ).toBeUndefined();
          continue;
        }
        expect(
          flagDeploymentForSelector(
            consumer.namespace ?? "",
            consumer.environment ?? "",
          ),
        ).toMatchObject({
          catalog: namespace,
          fliptEnvironment: environment,
        });
      }
    },
  );

  test("every flag deployment is selected by a chart", async () => {
    const charts = [
      (app: App) => createScoutChart(app, "beta"),
      (app: App) => createScoutChart(app, "prod"),
      (app: App) => createStarlightKarmaBotChart(app, "beta"),
      (app: App) => createStarlightKarmaBotChart(app, "prod"),
      (app: App) => createBirmelChart(app),
      (app: App) =>
        createMediaChart(app, "docker.io/shepherdjerred/media:delivery-recipe"),
      (app: App) => createTrmnlDashboardChart(app),
      (app: App) => createAlertDashboardChart(app),
      (app: App) => createTemporalChart(app),
      (app: App) => createArcadeChart(app),
      (app: App) => createWoodpeckerChart(app),
      (app: App) => createStormBrainChart(app),
      (app: App) => createStormForumCharts(app),
      (app: App) =>
        createTrackerChart(
          app,
          `docker.io/shepherdjerred/tracker@sha256:${"a".repeat(64)}`,
        ),
      (app: App) => {
        const activation = deliveryActivation();
        if (activation === undefined) {
          throw new Error("delivery chart has no activation to render");
        }
        return createDeliveryChart(app, activation);
      },
    ];
    const selected = new Set<string>();
    for (const createChart of charts) {
      for (const consumer of await fliptConsumers(createChart)) {
        if (
          consumer.name === "temporal-temporal-gateway" &&
          consumer.namespace === "temporal" &&
          consumer.environment === "beta"
        ) {
          continue;
        }
        if (
          consumer.namespace === undefined ||
          consumer.environment === undefined
        ) {
          throw new Error(
            `${consumer.name} evaluates flags without a namespace and environment`,
          );
        }
        const deployment = flagDeploymentForSelector(
          consumer.namespace,
          consumer.environment,
        );
        if (deployment === undefined) {
          throw new Error(
            `${consumer.name} reads ${consumer.namespace}/${consumer.environment}, which is not a deployment`,
          );
        }
        selected.add(deployment.id);
      }
    }
    const minecraft = new App();
    const minecraftChart = new Chart(minecraft, "minecraft-tsmc");
    createMinecraftTsmcApp(minecraftChart);
    const rendered = JSON.stringify(Testing.synth(minecraftChart));
    if (!rendered.includes("FLIPT_ENVIRONMENT")) {
      throw new Error("minecraft/tsmc does not set a Flipt environment");
    }
    // The chart sets the environment only. The server hardcodes namespace the-storm.
    selected.add("minecraft/tsmc");
    expect([...selected].sort()).toEqual(
      flagDeployments.map((deployment) => deployment.id).sort(),
    );
  });
});
