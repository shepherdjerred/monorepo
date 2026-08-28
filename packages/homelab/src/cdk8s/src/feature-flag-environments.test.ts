import { describe, expect, test } from "vitest";
import { App, Testing } from "cdk8s";
import { z } from "zod";
import { createBirmelChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/birmel.ts";
import { createMediaChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/media.ts";
import { createScoutChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/scout.ts";
import { createStarlightKarmaBotChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/starlight-karma-bot.ts";

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
): Promise<{ name: string; environment: string | undefined }[]> {
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
              },
            ];
          },
        );
      }),
  );
}

describe("Flipt consumer environments", () => {
  const cases: [string, string, (app: App) => void | Promise<void>][] = [
    ["Scout beta", "beta", (app: App) => createScoutChart(app, "beta")],
    ["Scout prod", "prod", (app: App) => createScoutChart(app, "prod")],
    [
      "Karma beta",
      "beta",
      (app: App) => createStarlightKarmaBotChart(app, "beta"),
    ],
    [
      "Karma prod",
      "prod",
      (app: App) => createStarlightKarmaBotChart(app, "prod"),
    ],
    ["Birmel", "prod", (app: App) => createBirmelChart(app)],
    ["Streambot", "prod", (app: App) => createMediaChart(app)],
  ];

  test.each(cases)(
    "sets %s to %s",
    async (_name, expectedEnvironment, createChart) => {
      const consumers = await fliptConsumers(createChart);
      expect(consumers).toHaveLength(1);
      expect(consumers[0]?.environment).toBe(expectedEnvironment);
    },
  );
});
