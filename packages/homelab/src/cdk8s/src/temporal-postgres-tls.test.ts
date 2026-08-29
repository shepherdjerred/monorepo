import { describe, expect, test } from "vitest";
import { App } from "cdk8s";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { createTemporalChart } from "./cdk8s-charts/temporal.ts";

const ResourceSchema = z
  .object({
    kind: z.string(),
    metadata: z.object({ name: z.string() }).loose(),
    spec: z.unknown().optional(),
  })
  .loose();

function resources() {
  const app = new App({ outdir: ".test-synth-temporal-postgres-tls" });
  createTemporalChart(app);
  return parseAllDocuments(app.synthYaml()).flatMap((document) => {
    const parsed = ResourceSchema.safeParse(document.toJSON());
    return parsed.success ? [parsed.data] : [];
  });
}

describe("Temporal PostgreSQL TLS", () => {
  test("issues a rotating certificate for service and pod DNS names", () => {
    const certificate = resources().find(
      (resource) =>
        resource.kind === "Certificate" &&
        resource.metadata.name === "temporal-postgresql",
    );
    const spec = z
      .object({
        secretName: z.literal("temporal-postgresql-tls"),
        dnsNames: z.array(z.string()),
        privateKey: z.object({ rotationPolicy: z.literal("Always") }),
      })
      .parse(certificate?.spec);

    expect(spec.dnsNames).toContain(
      "temporal-postgresql.temporal.svc.cluster.local",
    );
    expect(spec.dnsNames).toContain(
      "temporal-postgresql-0.temporal-postgresql.temporal.svc.cluster.local",
    );
  });

  test("configures the Zalando cluster to present the managed certificate", () => {
    const postgres = resources().find(
      (resource) =>
        resource.kind === "postgresql" &&
        resource.metadata.name === "temporal-postgresql",
    );
    const spec = z
      .object({
        tls: z.object({
          secretName: z.literal("temporal-postgresql-tls"),
          certificateFile: z.literal("tls.crt"),
          privateKeyFile: z.literal("tls.key"),
          caSecretName: z.literal("temporal-postgresql-tls"),
          caFile: z.literal("tls.crt"),
        }),
      })
      .parse(postgres?.spec);

    expect(spec.tls).toBeDefined();
  });
});
