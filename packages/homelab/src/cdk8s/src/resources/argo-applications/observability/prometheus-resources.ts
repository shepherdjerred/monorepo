import type { Chart } from "cdk8s";
import { tailnetService } from "homelab/src/platform-model.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { createIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { createAlertmanagerMailSmtpCa } from "@shepherdjerred/homelab/cdk8s/src/resources/mail/mail-smtp.ts";
import { createMonitoringApiAuth } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/monitoring-auth-gateways.ts";

function createPrometheusIngresses(chart: Chart): void {
  createIngress(chart, "alertmanager-ingress", {
    namespace: "prometheus",
    service: "prometheus-kube-prometheus-alertmanager",
    port: 9093,
    hosts: [tailnetService("alertmanager")],
    proxyClass: "medium",
    probePath: "/-/healthy",
  });

  createIngress(chart, "prometheus-ingress", {
    namespace: "prometheus",
    service: "prometheus-kube-prometheus-prometheus",
    port: 9090,
    hosts: [tailnetService("prometheus")],
    probePath: "/-/healthy",
  });
}

function createAlertmanagerMailSmtpSecret(chart: Chart): OnePasswordItem {
  return new OnePasswordItem(chart, "alertmanager-mail-smtp-onepassword", {
    spec: {
      itemPath: vaultItemPath("alertmanager-mail-smtp"),
    },
    metadata: {
      name: "alertmanager-mail-smtp",
      namespace: "prometheus",
    },
  });
}

/**
 * Homelab 1Password item backing `prometheus-secrets` (Grafana credentials and
 * `HOMEASSISTANT_TOKEN`). Shared by `alert-dashboard` for Home Assistant chore
 * actuation.
 */
export const PROMETHEUS_VAULT_ITEM_ID = "42fn7x3zaemfenz35en27thw5u";

/** Objects the root renders beside the Application; the `prometheus-companion` companion chart renders the same objects under transition rendering. */
export function createPrometheusResources(chart: Chart): {
  alertDashboardSecrets: OnePasswordItem;
  alertmanagerMailSmtp: OnePasswordItem;
  prometheusSecrets: OnePasswordItem;
  monitoringApiAuth: OnePasswordItem;
} {
  createPrometheusIngresses(chart);

  createIngress(chart, "grafana-ingress", {
    namespace: "prometheus",
    service: "prometheus-grafana",
    port: 80,
    hosts: [tailnetService("grafana")],
  });

  const alertDashboardSecrets = new OnePasswordItem(
    chart,
    "alert-dashboard-secrets-onepassword",
    {
      spec: { itemPath: vaultItemPath("alert-dashboard") },
      metadata: {
        name: "alert-dashboard-secrets",
        namespace: "prometheus",
      },
    },
  );

  const alertmanagerMailSmtp = createAlertmanagerMailSmtpSecret(chart);
  createAlertmanagerMailSmtpCa(chart);

  const prometheusSecrets = new OnePasswordItem(
    chart,
    "grafana-secret-onepassword",
    {
      spec: {
        itemPath: vaultItemPath(PROMETHEUS_VAULT_ITEM_ID),
      },
      metadata: {
        name: "prometheus-secrets",
        namespace: "prometheus",
      },
    },
  );
  return {
    alertDashboardSecrets,
    alertmanagerMailSmtp,
    prometheusSecrets,
    monitoringApiAuth: createMonitoringApiAuth(chart),
  };
}
