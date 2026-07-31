import { describe, expect, it } from "bun:test";
import { App, Chart } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createPostgresOperatorApp } from "./postgres-operator.ts";

const PostgresOperatorApplicationSchema = z.object({
  kind: z.literal("Application"),
  metadata: z.object({ name: z.literal("postgres-operator") }),
  spec: z.object({
    source: z.object({
      helm: z.object({
        valuesObject: z.looseObject({
          configGeneral: z.looseObject({
            kubernetes_use_configmaps: z.literal(true),
            workers: z.literal(1),
          }),
          configKubernetes: z.object({
            enable_cross_namespace_secret: z.literal(true),
            enable_pod_disruption_budget: z.literal(false),
          }),
          configPatroni: z.object({
            enable_patroni_failsafe_mode: z.literal(true),
          }),
        }),
      }),
    }),
  }),
});

describe("Postgres Operator Argo CD application", () => {
  it("only overrides deployment-specific operator settings", () => {
    const app = new App();
    const chart = new Chart(app, "test");
    createPostgresOperatorApp(chart);
    const manifest = parseAllDocuments(app.synthYaml())
      .map((document) =>
        PostgresOperatorApplicationSchema.safeParse(document.toJS()),
      )
      .find((result) => result.success);
    if (!manifest?.success) {
      throw new Error("Postgres Operator Application was not synthesized");
    }

    const values = manifest.data.spec.source.helm.valuesObject;
    expect(values.configGeneral).toEqual({
      kubernetes_use_configmaps: true,
      workers: 1,
    });
    expect(values.configKubernetes).toEqual(
      expect.objectContaining({
        enable_cross_namespace_secret: true,
        enable_pod_disruption_budget: false,
      }),
    );
    expect(values.configPatroni).toEqual({
      enable_patroni_failsafe_mode: true,
    });
    expect(values.configGeneral).not.toHaveProperty(
      "enable_maintenance_windows",
    );
    expect(values).not.toHaveProperty("configLogicalBackup");
  });
});
