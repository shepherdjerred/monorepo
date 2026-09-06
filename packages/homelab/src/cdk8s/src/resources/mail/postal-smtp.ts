import type { Chart } from "cdk8s";
import { EnvValue, Secret, Volume } from "cdk8s-plus-31";
import {
  createHomelabIssuedCertificate,
  HOMELAB_CLUSTER_CA_FILE,
  HOMELAB_CLUSTER_TLS_CERTIFICATE_FILE,
  HOMELAB_CLUSTER_TLS_PRIVATE_KEY_FILE,
} from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/cert-manager.ts";

export const POSTAL_SMTP_TLS_SECRET = "postal-smtp-tls";
export const POSTAL_SMTP_TLS_SERVER_NAME =
  "postal-postal-smtp-service.postal.svc.cluster.local";
export const POSTAL_SMTP_TLS_MOUNT_PATH = "/etc/postal/smtp-tls";
export const POSTAL_SMTP_TLS_CERTIFICATE_PATH = `${POSTAL_SMTP_TLS_MOUNT_PATH}/${HOMELAB_CLUSTER_TLS_CERTIFICATE_FILE}`;
export const POSTAL_SMTP_TLS_PRIVATE_KEY_PATH = `${POSTAL_SMTP_TLS_MOUNT_PATH}/${HOMELAB_CLUSTER_TLS_PRIVATE_KEY_FILE}`;
export const ALERTMANAGER_POSTAL_SMTP_CA_SECRET = "alertmanager-postal-smtp-ca";
export const ALERTMANAGER_POSTAL_SMTP_CA_MOUNT_PATH = `/etc/alertmanager/secrets/${ALERTMANAGER_POSTAL_SMTP_CA_SECRET}`;

export const POSTAL_SMTP_DNS_NAMES = [
  "postal-postal-smtp-service",
  "postal-postal-smtp-service.postal",
  "postal-postal-smtp-service.postal.svc",
  POSTAL_SMTP_TLS_SERVER_NAME,
];

// Postal loads SMTP TLS files at process start. The cluster has no secret
// reloader, so a leaf rotation needs a rollout before the previous certificate
// expires. Clients trust ca.crt, which does not rotate with the leaf.
export function createPostalSmtpTlsVolume(chart: Chart): Volume {
  createHomelabIssuedCertificate(chart, "postal-smtp-tls-certificate", {
    name: POSTAL_SMTP_TLS_SECRET,
    namespace: "postal",
    secretName: POSTAL_SMTP_TLS_SECRET,
    commonName: POSTAL_SMTP_TLS_SERVER_NAME,
    dnsNames: POSTAL_SMTP_DNS_NAMES,
    annotations: { "argocd.argoproj.io/sync-wave": "-1" },
  });
  return Volume.fromSecret(
    chart,
    "postal-smtp-tls-volume",
    Secret.fromSecretName(
      chart,
      "postal-smtp-tls-secret",
      POSTAL_SMTP_TLS_SECRET,
    ),
    { name: "smtp-tls" },
  );
}

export const POSTAL_SMTP_TLS_ENV = {
  SMTP_SERVER_TLS_ENABLED: EnvValue.fromValue("true"),
  SMTP_SERVER_TLS_CERTIFICATE_PATH: EnvValue.fromValue(
    POSTAL_SMTP_TLS_CERTIFICATE_PATH,
  ),
  SMTP_SERVER_TLS_PRIVATE_KEY_PATH: EnvValue.fromValue(
    POSTAL_SMTP_TLS_PRIVATE_KEY_PATH,
  ),
};

export function createAlertmanagerPostalSmtpCa(chart: Chart): void {
  createHomelabIssuedCertificate(chart, "alertmanager-postal-smtp-ca", {
    name: ALERTMANAGER_POSTAL_SMTP_CA_SECRET,
    namespace: "prometheus",
    secretName: ALERTMANAGER_POSTAL_SMTP_CA_SECRET,
    commonName: ALERTMANAGER_POSTAL_SMTP_CA_SECRET,
    dnsNames: [
      `${ALERTMANAGER_POSTAL_SMTP_CA_SECRET}.prometheus.svc.cluster.local`,
    ],
  });
}

export const ALERTMANAGER_POSTAL_SMTP_TLS = {
  smtp_smarthost: `${POSTAL_SMTP_TLS_SERVER_NAME}:25`,
  smtp_require_tls: true,
  smtp_tls_config: {
    ca_file: `${ALERTMANAGER_POSTAL_SMTP_CA_MOUNT_PATH}/${HOMELAB_CLUSTER_CA_FILE}`,
    server_name: POSTAL_SMTP_TLS_SERVER_NAME,
    insecure_skip_verify: false,
  },
};
