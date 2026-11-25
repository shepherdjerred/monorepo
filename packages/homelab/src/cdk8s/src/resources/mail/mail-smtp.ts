import type { Chart } from "cdk8s";
import { EnvValue, Secret, Volume } from "cdk8s-plus-31";
import { MAIL_SMTP_ENDPOINT } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/endpoint.ts";
import {
  createHomelabIssuedCertificate,
  HOMELAB_CLUSTER_CA_FILE,
  HOMELAB_CLUSTER_TLS_CERTIFICATE_FILE,
  HOMELAB_CLUSTER_TLS_PRIVATE_KEY_FILE,
} from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/cert-manager.ts";

export const MAIL_SMTP_TLS_SECRET = "mail-smtp-tls";
export const MAIL_SMTP_TLS_SERVER_NAME = MAIL_SMTP_ENDPOINT.host;
export const MAIL_SMTP_TLS_MOUNT_PATH = "/etc/mail/smtp-tls";
export const MAIL_SMTP_TLS_CERTIFICATE_PATH = `${MAIL_SMTP_TLS_MOUNT_PATH}/${HOMELAB_CLUSTER_TLS_CERTIFICATE_FILE}`;
export const MAIL_SMTP_TLS_PRIVATE_KEY_PATH = `${MAIL_SMTP_TLS_MOUNT_PATH}/${HOMELAB_CLUSTER_TLS_PRIVATE_KEY_FILE}`;
export const ALERTMANAGER_MAIL_SMTP_CA_SECRET = "alertmanager-mail-smtp-ca";
export const ALERTMANAGER_MAIL_SMTP_CA_MOUNT_PATH = `/etc/alertmanager/secrets/${ALERTMANAGER_MAIL_SMTP_CA_SECRET}`;

export const MAIL_SMTP_DNS_NAMES = [
  MAIL_SMTP_ENDPOINT.service,
  `${MAIL_SMTP_ENDPOINT.service}.${MAIL_SMTP_ENDPOINT.namespace}`,
  `${MAIL_SMTP_ENDPOINT.service}.${MAIL_SMTP_ENDPOINT.namespace}.svc`,
  MAIL_SMTP_TLS_SERVER_NAME,
];

/**
 * Issues the `homelab-ca-issuer` leaf certificate served by `@shepherdjerred/mail`
 * on `:25` `STARTTLS`. `TlsCertificateLoader` checks file mtime on each STARTTLS
 * upgrade so kubelet secret refreshes take effect without restarting the pod.
 */
export function createMailSmtpTlsVolume(chart: Chart): Volume {
  createHomelabIssuedCertificate(chart, "mail-smtp-tls-certificate", {
    name: MAIL_SMTP_TLS_SECRET,
    namespace: MAIL_SMTP_ENDPOINT.namespace,
    secretName: MAIL_SMTP_TLS_SECRET,
    commonName: MAIL_SMTP_TLS_SERVER_NAME,
    dnsNames: MAIL_SMTP_DNS_NAMES,
    annotations: { "argocd.argoproj.io/sync-wave": "-1" },
  });
  return Volume.fromSecret(
    chart,
    "mail-smtp-tls-volume",
    Secret.fromSecretName(chart, "mail-smtp-tls-secret", MAIL_SMTP_TLS_SECRET),
    { name: "smtp-tls" },
  );
}

/**
 * Issues a namespace-local `homelab-ca-issuer` certificate and returns a
 * `Volume` projecting only `ca.crt` so SMTP STARTTLS clients trust the cluster
 * CA without mounting private key material.
 */
export function createMailSmtpClientCaVolume(
  chart: Chart,
  options: {
    name: string;
    namespace: string;
    dnsName: string;
    volumeName?: string;
  },
): Volume {
  createHomelabIssuedCertificate(chart, `${options.name}-certificate`, {
    name: options.name,
    namespace: options.namespace,
    secretName: options.name,
    commonName: options.name,
    dnsNames: [options.dnsName],
    annotations: { "argocd.argoproj.io/sync-wave": "-1" },
  });
  return Volume.fromSecret(
    chart,
    `${options.name}-volume`,
    Secret.fromSecretName(chart, `${options.name}-secret`, options.name),
    {
      name: options.volumeName ?? "smtp-ca",
      items: { [HOMELAB_CLUSTER_CA_FILE]: { path: HOMELAB_CLUSTER_CA_FILE } },
    },
  );
}

export const MAIL_SMTP_TLS_ENV = {
  MAIL_SMTP_HOSTNAME: EnvValue.fromValue(MAIL_SMTP_TLS_SERVER_NAME),
  MAIL_SMTP_TLS_CERT_PATH: EnvValue.fromValue(MAIL_SMTP_TLS_CERTIFICATE_PATH),
  MAIL_SMTP_TLS_KEY_PATH: EnvValue.fromValue(MAIL_SMTP_TLS_PRIVATE_KEY_PATH),
};

export function createAlertmanagerMailSmtpCa(chart: Chart): void {
  createHomelabIssuedCertificate(chart, "alertmanager-mail-smtp-ca", {
    name: ALERTMANAGER_MAIL_SMTP_CA_SECRET,
    namespace: "prometheus",
    secretName: ALERTMANAGER_MAIL_SMTP_CA_SECRET,
    commonName: ALERTMANAGER_MAIL_SMTP_CA_SECRET,
    dnsNames: [
      `${ALERTMANAGER_MAIL_SMTP_CA_SECRET}.prometheus.svc.cluster.local`,
    ],
  });
}

export const ALERTMANAGER_MAIL_SMTP_TLS = {
  smtp_smarthost: `${MAIL_SMTP_TLS_SERVER_NAME}:${String(MAIL_SMTP_ENDPOINT.port)}`,
  smtp_require_tls: true,
  smtp_tls_config: {
    ca_file: `${ALERTMANAGER_MAIL_SMTP_CA_MOUNT_PATH}/${HOMELAB_CLUSTER_CA_FILE}`,
    server_name: MAIL_SMTP_TLS_SERVER_NAME,
    insecure_skip_verify: false,
  },
};
