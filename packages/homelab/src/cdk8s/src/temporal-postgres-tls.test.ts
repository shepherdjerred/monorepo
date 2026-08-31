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
        // Must be the explicit literal "Never", not merely absent: leaving
        // rotationPolicy unset defaults to "Always" on cert-manager >=v1.18,
        // which would silently regenerate this key (and the certificate
        // every leaf's ca.crt points at) on every renewal.
        privateKey: z.object({ rotationPolicy: z.literal("Never") }),
      })
      .parse(ca.spec);

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
        // Strict: the CA ships inside secretName, so caSecretName must stay
        // absent (see the duplicate-volume guard below).
        tls: z
          .object({
            secretName: z.literal("temporal-postgresql-tls"),
            certificateFile: z.literal("tls.crt"),
            privateKeyFile: z.literal("tls.key"),
            // Clients must trust cert-manager's injected ca.crt (the stable
            // CA), never the leaf's own tls.crt, which rotates.
            caFile: z.literal("ca.crt"),
          })
          .strict(),
      })
      .parse(postgres.spec);

    expect(spec.tls.caFile).toBe("ca.crt");
  });

  // Without an fsGroup the operator's 0640 TLS mount stays root:root and
  // Postgres dies with "could not load server certificate file: Permission
  // denied", so Patroni never leaves "start failed". Enabling TLS and setting
  // spiloFSGroup are one change, not two.
  test("grants the postgres user read access to its own TLS material", () => {
    const postgres = findTemporalResource(
      resources(),
      "postgresql",
      "temporal-postgresql",
    );
    const spec = z
      .object({
        spiloFSGroup: z.number(),
        tls: z.object({ secretName: z.string() }),
      })
      .parse(postgres.spec);

    // uid=101(postgres) gid=103(postgres) in the Spilo image.
    expect(spec.spiloFSGroup).toBe(103);
  });

  // Regression guard for a defect that left the Temporal database with no
  // controller. The operator's generateTlsMounts appends one volume named
  // after tls.secretName and, when tls.caSecretName is set, a second named
  // after tls.caSecretName. Naming the same secret in both fields emits two
  // volumes with one name, the API server rejects the StatefulSet as invalid,
  // and because the operator deletes before it re-creates, the running pod is
  // orphaned with nothing left to recreate it.
  test("never names one secret in both TLS fields, which would emit duplicate volumes", () => {
    const postgres = findTemporalResource(
      resources(),
      "postgresql",
      "temporal-postgresql",
    );
    const tls = z
      .object({
        secretName: z.string(),
        caSecretName: z.string().optional(),
      })
      .parse(z.object({ tls: z.unknown() }).parse(postgres.spec).tls);

    // The operator derives a volume name from each field it is given, so the
    // set of names it would generate must have no duplicates.
    const volumeNames = [tls.secretName, tls.caSecretName].filter(
      (name) => name !== undefined,
    );
    expect(volumeNames).toStrictEqual([...new Set(volumeNames)]);
  });
});
