import { expect, test } from "vitest";
import { App } from "cdk8s";
import { z } from "zod";
import { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import { setupCharts } from "@shepherdjerred/homelab/cdk8s/src/setup-charts.ts";
import { deliveryEnvironment } from "homelab/src/delivery-ownership.ts";

test("neutral root inventory equals actual active repository-chart Applications", async () => {
  const app = new App();
  await setupCharts(app);
  const schema = z.object({
    kind: z.literal("Application"),
    spec: z.object({
      source: z.object({ repoURL: z.string(), chart: z.string().optional() }),
    }),
  });
  const charts = app.charts
    .flatMap((chart) => z.array(z.unknown()).parse(chart.toJson()))
    .flatMap((resource) => {
      const parsed = schema.safeParse(resource);
      if (!parsed.success) return [];
      const application = parsed.data;
      if (deliveryEnvironment(resource) !== undefined) return [];
      return application.spec.source.repoURL ===
        "https://chartmuseum.tailnet-1a49.ts.net" &&
        application.spec.source.chart !== undefined
        ? [application.spec.source.chart]
        : [];
    });
  expect([...new Set(charts)].sort()).toEqual(
    new ServiceIndex()
      .rootReleaseCharts()
      .map((chart) => chart.name)
      .sort(),
  );
});
