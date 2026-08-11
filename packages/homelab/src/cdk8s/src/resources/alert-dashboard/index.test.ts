import { describe, expect, test } from "bun:test";
import { App } from "cdk8s";
import { z } from "zod";
import { createAlertDashboardChart } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/alert-dashboard.ts";

const DeploymentSchema = z.object({
  kind: z.literal("Deployment"),
  metadata: z.object({ name: z.literal("alert-dashboard") }).loose(),
  spec: z.object({
    template: z.object({
      spec: z.object({
        volumes: z.array(
          z
            .object({
              name: z.string(),
              secret: z.object({ secretName: z.string() }).loose().optional(),
            })
            .loose(),
        ),
      }),
    }),
  }),
});

describe("Alert Dashboard deployment", () => {
  test("mounts the Zalando-normalized database user secret", () => {
    const app = new App();
    createAlertDashboardChart(app);
    const manifests = z.array(z.unknown()).parse(app.charts.at(0)?.toJson());
    const deployment = manifests
      .map((manifest) => DeploymentSchema.safeParse(manifest))
      .find((result) => result.success)?.data;
    if (deployment === undefined) {
      throw new Error("Missing Deployment/alert-dashboard manifest");
    }
    const postgresSecret = deployment.spec.template.spec.volumes.find(
      (volume) => volume.name === "pg-secret",
    )?.secret?.secretName;

    expect(postgresSecret).toBe(
      "alert-dashboard.alert-dashboard-postgresql.credentials.postgresql.acid.zalan.do",
    );
  });
});
