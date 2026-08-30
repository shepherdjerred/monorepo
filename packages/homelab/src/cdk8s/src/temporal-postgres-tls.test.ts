import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  findTemporalResource,
  synthesizeTemporalResources,
} from "./temporal-test-resources.ts";

function resources() {
  return synthesizeTemporalResources(".test-synth-temporal-postgres-tls");
}

describe("Temporal PostgreSQL TLS", () => {
  test("issues a rotating leaf certificate for service and pod DNS names", () => {
    const certificate = findTemporalResource(
      resources(),
      "Certificate",
      "temporal-postgresql",
    );
    const spec = z
      .object({
        secretName: z.literal("temporal-postgresql-tls"),
        dnsNames: z.array(z.string()),
        issuerRef: z.object({ name: z.string(), kind: z.literal("Issuer") }),
        privateKey: z.object({ rotationPolicy: z.literal("Always") }),
      })
      .parse(certificate.spec);

    expect(spec.dnsNames).toContain(
      "temporal-postgresql.temporal.svc.cluster.local",
    );
    expect(spec.dnsNames).toContain(
      "temporal-postgresql-0.temporal-postgresql.temporal.svc.cluster.local",
    );

    // The leaf must be issued by the stable CA issuer, not directly by the
    // self-signed issuer — otherwise every key rotation replaces the trust
    // anchor clients rely on.
    expect(spec.issuerRef.name).toBe("temporal-postgresql-ca-issuer");
  });

  test("keeps the CA certificate's key stable across leaf renewals", () => {
    const synthesized = resources();
    const ca = findTemporalResource(
      synthesized,
      "Certificate",
      "temporal-postgresql-ca",
    );
    const caSpec = z
      .object({
        secretName: z.literal("temporal-postgresql-ca"),
        isCA: z.literal(true),
        issuerRef: z.object({
          name: z.literal("temporal-postgresql-self-signed"),
          kind: z.literal("Issuer"),
        }),
        privateKey: z
          .object({ rotationPolicy: z.string().optional() })
          .optional(),
      })
      .parse(ca.spec);

    // Never rotate the CA's key: rotationPolicy defaults to Never when
    // unset, which is what keeps this certificate a stable trust anchor.
    expect(caSpec.privateKey?.rotationPolicy).not.toBe("Always");

    const caIssuer = findTemporalResource(
      synthesized,
      "Issuer",
      "temporal-postgresql-ca-issuer",
    );
    const caIssuerSpec = z
      .object({ ca: z.object({ secretName: z.literal(caSpec.secretName) }) })
      .parse(caIssuer.spec);
    expect(caIssuerSpec.ca.secretName).toBe(caSpec.secretName);
  });

  test("configures the Zalando cluster to present the managed certificate and trust the stable CA", () => {
    const postgres = findTemporalResource(
      resources(),
      "postgresql",
      "temporal-postgresql",
    );
    const spec = z
      .object({
        tls: z.object({
          secretName: z.literal("temporal-postgresql-tls"),
          certificateFile: z.literal("tls.crt"),
          privateKeyFile: z.literal("tls.key"),
          caSecretName: z.literal("temporal-postgresql-tls"),
          // Clients must trust cert-manager's injected ca.crt (the stable
          // CA), never the leaf's own tls.crt, which rotates.
          caFile: z.literal("ca.crt"),
        }),
      })
      .parse(postgres.spec);

    expect(spec.tls).toBeDefined();
  });
});
