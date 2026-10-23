import type { Chart } from "cdk8s";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { createIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { createAlertmanagerPostalSmtpCa } from "@shepherdjerred/homelab/cdk8s/src/resources/mail/postal-smtp.ts";
import { createMonitoringApiAuth } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/monitoring-auth-gateways.ts";

function createPrometheusIngresses(chart: Chart): void {
  createIngress(chart, "alertmanager-ingress", {
    namespace: "prometheus",
    service: "prometheus-kube-prometheus-alertmanager",
    port: 9093,
    hosts: ["alertmanager"],
    proxyClass: "medium",
    probePath: "/-/healthy",
  });

  createIngress(chart, "prometheus-ingress", {
    namespace: "prometheus",
    service: "prometheus-kube-prometheus-prometheus",
    port: 9090,
    hosts: ["prometheus"],
    probePath: "/-/healthy",
  });
}

function createAlertmanagerPostalSmtpSecret(chart: Chart): OnePasswordItem {
  return new OnePasswordItem(chart, "alertmanager-postal-smtp-onepassword", {
    spec: {
      itemPath: vaultItemPath("cb2p2ogrqzdzz4it43jq3wyrei"),
    },
    metadata: {
      name: "alertmanager-postal-smtp",
      namespace: "prometheus",
    },
  });
}

/** Objects the root renders beside the Application; the `prometheus-companion` companion chart renders the same objects under transition rendering. */
export function createPrometheusResources(chart: Chart): {
  alertDashboardSecrets: OnePasswordItem;
  alertmanagerPostalSmtp: OnePasswordItem;
  prometheusSecrets: OnePasswordItem;
  monitoringApiAuth: OnePasswordItem;
} {
  createPrometheusIngresses(chart);

  createIngress(chart, "grafana-ingress", {
    namespace: "prometheus",
    service: "prometheus-grafana",
    port: 80,
    hosts: ["grafana"],
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

  const alertmanagerPostalSmtp = createAlertmanagerPostalSmtpSecret(chart);
  createAlertmanagerPostalSmtpCa(chart);

  const prometheusSecrets = new OnePasswordItem(
    chart,
    "grafana-secret-onepassword",
    {
      spec: {
        itemPath: vaultItemPath("42fn7x3zaemfenz35en27thw5u"),
      },
      metadata: {
        name: "prometheus-secrets",
        namespace: "prometheus",
      },
    },
  );
  return {
    alertDashboardSecrets,
    alertmanagerPostalSmtp,
    prometheusSecrets,
    monitoringApiAuth: createMonitoringApiAuth(chart),
  };
}
