import { describe, expect, test } from "vitest";
import { App, Chart, Testing } from "cdk8s";
import { z } from "zod";
import { flagDeployments } from "@shepherdjerred/feature-flags/deployments.ts";
import {
  FLAGS_EVALUATION_URL,
  FLAGS_MANAGEMENT_URL,
} from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
import { createArcadeChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/games/arcade.ts";
import { createBirmelChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/birmel.ts";
import { createMediaChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/media/media.ts";
import { createScoutChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/scout.ts";
import { createStarlightKarmaBotChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/starlight-karma-bot.ts";
import { createStormBrainChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/storm-brain.ts";
import { createStormStatsChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/storm-stats.ts";
import { createDeliveryChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/delivery.ts";
import { createGolinkChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/platform/golink.ts";
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

async function flagsConsumers(
  createChart: (app: App) => void | Promise<void>,
): Promise<
  {
    name: string;
    mode: string | undefined;
    deployment: string | undefined;
    url: string | undefined;
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
            for (const legacy of [
              "FLIPT_NAMESPACE",
              "FLIPT_ENVIRONMENT",
              "FLIPT_URL",
              "FLIPT_OPERATOR_TOKEN",
            ]) {
              expect(
                env.has(legacy),
                `${parsed.data.metadata.name} still sets ${legacy}`,
              ).toBe(false);
            }
            const mode = env.get("FEATURE_FLAGS_MODE");
            expect(mode).not.toBe("flipt");
            if (mode !== "flags") return [];
            return [
              {
                name: parsed.data.metadata.name,
                mode,
                deployment: env.get("FLAGS_DEPLOYMENT"),
                url: env.get("FLAGS_URL"),
              },
            ];
          },
        );
      }),
  );
}

describe("First-party Flags consumer deployments", () => {
  const cases = [
    {
      name: "Scout beta",
      deployment: "scout/beta",
      // Application, gateway and activity worker all evaluate the
      // same scout/beta flags from separate pods.
      count: 3,
      createChart: (app: App) => createScoutChart(app, "beta"),
    },
    {
      name: "Scout prod",
      deployment: "scout/prod",
      // Application, gateway and activity worker share scout/prod.
      count: 3,
      createChart: (app: App) => createScoutChart(app, "prod"),
    },
    {
      name: "Karma beta",
      deployment: "starlight-karma-bot/beta",
      count: 1,
      createChart: (app: App) => createStarlightKarmaBotChart(app, "beta"),
    },
    {
      name: "Karma prod",
      deployment: "starlight-karma-bot/prod",
      count: 1,
      createChart: (app: App) => createStarlightKarmaBotChart(app, "prod"),
    },
    {
      name: "Birmel",
      deployment: "birmel/prod",
      count: 1,
      createChart: (app: App) => createBirmelChart(app),
    },
    {
      name: "Streambot",
      deployment: "streambot/prod",
      count: 1,
      createChart: (app: App) => createMediaChart(app),
    },
    {
      name: "TRMNL dashboard",
      deployment: "trmnl-dashboard/prod",
      count: 1,
      createChart: (app: App) => createTrmnlDashboardChart(app),
    },
    {
      name: "Hub",
      deployment: "alert-dashboard/prod",
      count: 1,
      createChart: (app: App) => {
        createAlertDashboardChart(app);
      },
    },
    {
      name: "Temporal",
      deployment: "temporal/prod",
      count: 11,
      createChart: (app: App) => createTemporalChart(app),
    },
  ];

  test.each(cases)(
    "sets $name to $deployment",
    async ({ deployment, count, createChart }) => {
      const consumers = await flagsConsumers(createChart);
      expect(consumers).toHaveLength(count);
      for (const consumer of consumers) {
        expect(consumer.mode).toBe("flags");
        expect(consumer.deployment).toBe(deployment);
        expect(consumer.url).toBe(
          consumer.name === "temporal-temporal-repo-worker"
            ? FLAGS_MANAGEMENT_URL
            : FLAGS_EVALUATION_URL,
        );
      }
    },
  );

  test("temporal-temporal-gateway selects temporal/prod", async () => {
    const consumers = await flagsConsumers((app) => createTemporalChart(app));
    const gateway = consumers.find(
      (consumer) => consumer.name === "temporal-temporal-gateway",
    );
    expect(gateway).toEqual({
      name: "temporal-temporal-gateway",
      mode: "flags",
      deployment: "temporal/prod",
      url: FLAGS_EVALUATION_URL,
    });
  });

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
      (app: App) => createStormStatsChart(app),
      (app: App) => createStormForumCharts(app),
      (app: App) =>
        createGolinkChart(app, {
          image: "docker.io/shepherdjerred/golink:delivery-recipe",
        }),
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
    const knownDeployments = new Set<string>(
      flagDeployments.map((deployment) => deployment.id),
    );
    const selected = new Set<string>();
    for (const createChart of charts) {
      for (const consumer of await flagsConsumers(createChart)) {
        if (consumer.deployment === undefined || consumer.url === undefined) {
          throw new Error(
            `${consumer.name} evaluates flags without FLAGS_DEPLOYMENT and FLAGS_URL`,
          );
        }
        expect(consumer.url).toBe(
          consumer.name === "temporal-temporal-repo-worker"
            ? FLAGS_MANAGEMENT_URL
            : FLAGS_EVALUATION_URL,
        );
        if (!knownDeployments.has(consumer.deployment)) {
          throw new Error(
            `${consumer.name} reads ${consumer.deployment}, which is not a deployment`,
          );
        }
        selected.add(consumer.deployment);
      }
    }
    const minecraft = new App();
    const minecraftChart = new Chart(minecraft, "minecraft-tsmc");
    const minecraftApp = createMinecraftTsmcApp(minecraftChart).toJson();
    const minecraftEnv = z
      .object({
        spec: z.object({
          source: z.object({
            helm: z.object({
              valuesObject: z.object({
                extraEnv: z.record(z.string(), z.unknown()),
              }),
            }),
          }),
        }),
      })
      .parse(minecraftApp).spec.source.helm.valuesObject.extraEnv;
    expect(minecraftEnv["FLAGS_URL"]).toBe(FLAGS_EVALUATION_URL);
    expect(minecraftEnv["FLAGS_DEPLOYMENT"]).toBe("minecraft/tsmc");
    expect(minecraftEnv["FLIPT_URL"]).toBeUndefined();
    expect(minecraftEnv["FLIPT_ENVIRONMENT"]).toBeUndefined();
    selected.add(String(minecraftEnv["FLAGS_DEPLOYMENT"]));
    expect([...selected].sort()).toEqual(
      flagDeployments.map((deployment) => deployment.id).sort(),
    );
  });
});
