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
        valuesObject: z.object({
          configGeneral: z.object({
            enable_maintenance_windows: z.literal(true),
          }),
          configLogicalBackup: z.object({
            logical_backup_successful_jobs_history_limit: z.literal(3),
            logical_backup_failed_jobs_history_limit: z.literal(3),
            logical_backup_ttl_seconds_after_finished: z.literal(86_400),
          }),
        }),
      }),
    }),
  }),
});

describe("Postgres Operator Argo CD application", () => {
  it("declares CRD defaults that would otherwise cause live-state drift", () => {
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

    expect(manifest.data.spec.source.helm.valuesObject).toEqual(
      expect.objectContaining({
        configGeneral: expect.objectContaining({
          enable_maintenance_windows: true,
        }),
        configLogicalBackup: {
          logical_backup_successful_jobs_history_limit: 3,
          logical_backup_failed_jobs_history_limit: 3,
          logical_backup_ttl_seconds_after_finished: 86_400,
        },
      }),
    );
  });
});
