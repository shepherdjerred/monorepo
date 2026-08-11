import type { Chart } from "cdk8s";
import {
  Certificate,
  CertificateSpecPrivateKeyAlgorithm,
  CertificateSpecPrivateKeyEncoding,
  CertificateSpecPrivateKeyRotationPolicy,
  CertificateSpecRenewalPolicy,
  CertificateSpecUsages,
  Issuer,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/cert-manager.io.ts";

const SELF_SIGNED_ISSUER_NAME = "alert-dashboard-postgresql-selfsigned";
const CA_ISSUER_NAME = "alert-dashboard-postgresql-ca";
export const ALERT_DASHBOARD_POSTGRES_CA_SECRET =
  "alert-dashboard-postgresql-ca";
export const ALERT_DASHBOARD_POSTGRES_TLS_SECRET =
  "alert-dashboard-postgresql-tls";
export const ALERT_DASHBOARD_POSTGRES_CA_MOUNT_PATH = "/postgres-ca";

const syncWave = (wave: number) => ({
  "argocd.argoproj.io/sync-wave": wave.toString(),
});

export function createAlertDashboardPostgreSqlTls(chart: Chart): void {
  new Issuer(chart, "alert-dashboard-postgresql-selfsigned-issuer", {
    metadata: {
      name: SELF_SIGNED_ISSUER_NAME,
      annotations: syncWave(-4),
    },
    spec: { selfSigned: {} },
  });

  new Certificate(chart, "alert-dashboard-postgresql-ca-certificate", {
    metadata: {
      name: ALERT_DASHBOARD_POSTGRES_CA_SECRET,
      annotations: syncWave(-3),
    },
    spec: {
      commonName: ALERT_DASHBOARD_POSTGRES_CA_SECRET,
      duration: "87600h",
      isCa: true,
      issuerRef: { kind: "Issuer", name: SELF_SIGNED_ISSUER_NAME },
      privateKey: {
        algorithm: CertificateSpecPrivateKeyAlgorithm.RSA,
        encoding: CertificateSpecPrivateKeyEncoding.PKCS8,
        rotationPolicy: CertificateSpecPrivateKeyRotationPolicy.NEVER,
        size: 2048,
      },
      // cert-manager does not safely roll a CA and all of its consumers as one
      // transaction. Keep this root stable; its ten-year replacement is a
      // deliberate trust migration rather than an unattended renewal.
      renewal: { policy: CertificateSpecRenewalPolicy.DISABLED },
      revisionHistoryLimit: 2,
      secretName: ALERT_DASHBOARD_POSTGRES_CA_SECRET,
      usages: [
        CertificateSpecUsages.CERT_SIGN,
        CertificateSpecUsages.CRL_SIGN,
        CertificateSpecUsages.DIGITAL_SIGNATURE,
      ],
    },
  });

  new Issuer(chart, "alert-dashboard-postgresql-ca-issuer", {
    metadata: {
      name: CA_ISSUER_NAME,
      annotations: syncWave(-2),
    },
    spec: { ca: { secretName: ALERT_DASHBOARD_POSTGRES_CA_SECRET } },
  });

  new Certificate(chart, "alert-dashboard-postgresql-server-certificate", {
    metadata: {
      name: ALERT_DASHBOARD_POSTGRES_TLS_SECRET,
      annotations: syncWave(-1),
    },
    spec: {
      dnsNames: [
        "alert-dashboard-postgresql",
        "alert-dashboard-postgresql.alert-dashboard",
        "alert-dashboard-postgresql.alert-dashboard.svc",
        "alert-dashboard-postgresql.alert-dashboard.svc.cluster.local",
      ],
      duration: "2160h",
      issuerRef: { kind: "Issuer", name: CA_ISSUER_NAME },
      privateKey: {
        algorithm: CertificateSpecPrivateKeyAlgorithm.RSA,
        encoding: CertificateSpecPrivateKeyEncoding.PKCS8,
        rotationPolicy: CertificateSpecPrivateKeyRotationPolicy.ALWAYS,
        size: 2048,
      },
      renewBefore: "360h",
      revisionHistoryLimit: 2,
      secretName: ALERT_DASHBOARD_POSTGRES_TLS_SECRET,
      usages: [
        CertificateSpecUsages.SERVER_AUTH,
        CertificateSpecUsages.DIGITAL_SIGNATURE,
        CertificateSpecUsages.KEY_ENCIPHERMENT,
      ],
    },
  });
}
