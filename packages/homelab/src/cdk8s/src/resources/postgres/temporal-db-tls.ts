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
// cert-manager populates `ca.crt` in every Certificate issued by a `ca`-typed
// Issuer with that issuer's (stable) CA certificate — not the leaf's own
// certificate. Clients must trust THIS file, not
// TEMPORAL_POSTGRES_TLS_CERTIFICATE_FILE: the leaf rotates its key on every
// renewal (rotationPolicy: Always), so a client trusting the leaf cert itself
// would lose its trust anchor the moment the leaf rotates, with no
// coordinated reload between the PostgreSQL and Temporal pods.
export const TEMPORAL_POSTGRES_TLS_CA_FILE = "ca.crt";
export const TEMPORAL_POSTGRES_TLS_SERVER_NAME =
  "temporal-postgresql.temporal.svc.cluster.local";

const TEMPORAL_POSTGRES_CA_SECRET = "temporal-postgresql-ca";

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
  const selfSignedIssuerName = "temporal-postgresql-self-signed";
  const caIssuerName = "temporal-postgresql-ca-issuer";

  new Issuer(chart, "temporal-postgresql-issuer", {
    metadata: {
      name: selfSignedIssuerName,
      annotations: { "argocd.argoproj.io/sync-wave": "-4" },
    },
    spec: { selfSigned: {} },
  });

  // A stable, long-lived root CA: rotationPolicy is pinned to Never so its
  // private key is only (re)generated if the secret doesn't already hold one
  // — the default flipped to Always in cert-manager >=v1.18, which would
  // silently regenerate this key (and therefore the certificate clients
  // trust) on every renewal if left unset. This is the only certificate the
  // self-signed Issuer directly issues.
  new Certificate(chart, "temporal-postgresql-ca-certificate", {
    metadata: {
      name: TEMPORAL_POSTGRES_CA_SECRET,
      annotations: { "argocd.argoproj.io/sync-wave": "-4" },
    },
    spec: {
      secretName: TEMPORAL_POSTGRES_CA_SECRET,
      commonName: "temporal-postgresql-ca",
      isCa: true,
      duration: "87600h", // 10 years
      renewBefore: "720h",
      issuerRef: { name: selfSignedIssuerName, kind: "Issuer" },
      privateKey: {
        algorithm: CertificateSpecPrivateKeyAlgorithm.ECDSA,
        size: 256,
        rotationPolicy: CertificateSpecPrivateKeyRotationPolicy.NEVER,
      },
      usages: [CertificateSpecUsages.CERT_SIGN, CertificateSpecUsages.CRL_SIGN],
    },
  });

  // Signs leaf certificates from the stable CA above, so rotating a leaf's
  // key never changes what clients need to trust.
  new Issuer(chart, "temporal-postgresql-ca-issuer", {
    metadata: {
      name: caIssuerName,
      annotations: { "argocd.argoproj.io/sync-wave": "-3" },
    },
    spec: { ca: { secretName: TEMPORAL_POSTGRES_CA_SECRET } },
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
      issuerRef: { name: caIssuerName, kind: "Issuer" },
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
