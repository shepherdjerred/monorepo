import type { Chart } from "cdk8s";
import {
  Certificate,
  CertificateSpecPrivateKeyAlgorithm,
  CertificateSpecPrivateKeyRotationPolicy,
  CertificateSpecUsages,
  Issuer,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/cert-manager.io.ts";

export const TEMPORAL_POSTGRES_TLS_SECRET = "temporal-postgresql-tls";
export const TEMPORAL_POSTGRES_TLS_CERTIFICATE_FILE = "tls.crt";
export const TEMPORAL_POSTGRES_TLS_PRIVATE_KEY_FILE = "tls.key";
export const TEMPORAL_POSTGRES_TLS_SERVER_NAME =
  "temporal-postgresql.temporal.svc.cluster.local";

const POSTGRES_DNS_NAMES = [
  "temporal-postgresql",
  "temporal-postgresql.temporal",
  "temporal-postgresql.temporal.svc",
  TEMPORAL_POSTGRES_TLS_SERVER_NAME,
  "temporal-postgresql-0.temporal-postgresql",
  "temporal-postgresql-0.temporal-postgresql.temporal",
  "temporal-postgresql-0.temporal-postgresql.temporal.svc",
  "temporal-postgresql-0.temporal-postgresql.temporal.svc.cluster.local",
];

export function createTemporalPostgreSQLCertificate(chart: Chart) {
  const issuerName = "temporal-postgresql-self-signed";

  new Issuer(chart, "temporal-postgresql-issuer", {
    metadata: {
      name: issuerName,
      annotations: { "argocd.argoproj.io/sync-wave": "-4" },
    },
    spec: { selfSigned: {} },
  });

  return new Certificate(chart, "temporal-postgresql-certificate", {
    metadata: {
      name: "temporal-postgresql",
      annotations: { "argocd.argoproj.io/sync-wave": "-3" },
    },
    spec: {
      secretName: TEMPORAL_POSTGRES_TLS_SECRET,
      commonName: TEMPORAL_POSTGRES_TLS_SERVER_NAME,
      dnsNames: POSTGRES_DNS_NAMES,
      duration: "8760h",
      renewBefore: "720h",
      issuerRef: { name: issuerName, kind: "Issuer" },
      privateKey: {
        algorithm: CertificateSpecPrivateKeyAlgorithm.ECDSA,
        size: 256,
        rotationPolicy: CertificateSpecPrivateKeyRotationPolicy.ALWAYS,
      },
      usages: [
        CertificateSpecUsages.SERVER_AUTH,
        CertificateSpecUsages.DIGITAL_SIGNATURE,
        CertificateSpecUsages.KEY_ENCIPHERMENT,
      ],
    },
  });
}
