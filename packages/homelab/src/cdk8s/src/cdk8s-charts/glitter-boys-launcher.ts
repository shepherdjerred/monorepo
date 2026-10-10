import type { App } from "cdk8s";
import { Chart, Duration, Size } from "cdk8s";
import {
  ConfigMap,
  Cpu,
  Deployment,
  EnvValue,
  Namespace,
  Probe,
  Secret,
  Service,
} from "cdk8s-plus-31";
import {
  KubeNetworkPolicy,
  IntOrString,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import {
  PrometheusRule,
  PrometheusRuleSpecGroupsRulesExpr as Expr,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com.ts";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import { createServiceMonitor } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/service-monitor.ts";
import { dnsEgressRule } from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import {
  withCommonProps,
  setRevisionHistoryLimit,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import release from "@shepherdjerred/homelab/cdk8s/src/resources/glitter-boys-launcher/release.json";

export function createGlitterBoysLauncherChart(
  app: App,
  releaseState = release,
  image = versions["shepherdjerred/glitter-boys-launcher"],
) {
  const name = "glitter-boys-launcher";
  const chart = new Chart(app, name, {
    namespace: name,
    disableResourceNameHashes: true,
  });
  if (
    releaseState.schemaVersion !== 1 ||
    !["prepared", "active"].includes(releaseState.stage)
  )
    throw new Error("Invalid launcher service release stage");
  // Like storm-forum's release inventory, preparation renders no live workload.
  // Activate only after a real image and the Bugsink project grant exist.
  if (releaseState.stage === "prepared") return chart;
  if (
    !/^[\w.-]+@sha256:[a-f0-9]{64}$/.test(image) ||
    image.endsWith("0".repeat(64))
  )
    throw new Error("Publish the launcher service image before activation");
  new Namespace(chart, "namespace", { metadata: { name } });
  const item = new OnePasswordItem(chart, "credentials", {
    spec: { itemPath: vaultItemPath("glitter-boys-launcher-credentials") },
  });
  const secret = Secret.fromSecretName(chart, "secret", item.name);
  const deployment = new Deployment(chart, "service", {
    replicas: 1,
    podMetadata: { labels: { app: name } },
  });
  deployment.addContainer(
    withCommonProps({
      name,
      image: `ghcr.io/shepherdjerred/glitter-boys-launcher:${image}`,
      ports: [
        { number: 8080, name: "http" },
        { number: 9091, name: "metrics" },
      ],
      envVariables: {
        SENTRY_DSN: EnvValue.fromSecretValue({ secret, key: "SENTRY_DSN" }),
      },
      securityContext: {
        user: 1000,
        group: 1000,
        ensureNonRoot: true,
        readOnlyRootFilesystem: true,
        allowPrivilegeEscalation: false,
      },
      resources: {
        cpu: { request: Cpu.millis(25), limit: Cpu.millis(250) },
        memory: { request: Size.mebibytes(32), limit: Size.mebibytes(128) },
      },
      readiness: Probe.fromHttpGet("/healthz", {
        port: 8080,
        periodSeconds: Duration.seconds(10),
      }),
      liveness: Probe.fromHttpGet("/healthz", {
        port: 8080,
        periodSeconds: Duration.seconds(30),
      }),
    }),
  );
  setRevisionHistoryLimit(deployment, 5);
  const service = new Service(chart, "http", {
    selector: deployment,
    ports: [{ name: "http", port: 8080 }],
  });
  new Service(chart, "metrics", {
    selector: deployment,
    metadata: { labels: { app: name, component: "metrics" } },
    ports: [{ name: "metrics", port: 9091 }],
  });
  createCloudflareTunnelBinding(chart, "public", {
    serviceName: service.name,
    fqdn: "launcher.glitter-boys.com",
    port: 8080,
    probePath: "/healthz",
    publicProbePath: "/healthz",
  });
  createServiceMonitor(chart, {
    name,
    namespace: name,
    matchLabels: { app: name, component: "metrics" },
    port: "metrics",
  });
  new KubeNetworkPolicy(chart, "network", {
    spec: {
      podSelector: {},
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "cloudflare-tunnel",
                },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(8080) }],
        },
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "prometheus" },
              },
            },
          ],
          ports: [
            { port: IntOrString.fromNumber(8080) },
            { port: IntOrString.fromNumber(9091) },
          ],
        },
      ],
      egress: [
        dnsEgressRule(),
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [{ port: IntOrString.fromNumber(443) }],
        },
      ],
    },
  });
  new PrometheusRule(chart, "alerts", {
    metadata: { labels: { release: "prometheus" } },
    spec: {
      groups: [
        {
          name,
          rules: [
            {
              alert: "GlitterLauncherFailures",
              for: "10m",
              labels: { severity: "warning" },
              annotations: {
                summary: "Launcher operations are failing repeatedly",
              },
              expr: Expr.fromString(
                'sum(increase(glitter_launcher_events_total{outcome="failed"}[1h])) >= 3 and sum(increase(glitter_launcher_events_total{outcome="failed"}[1h])) / clamp_min(sum(increase(glitter_launcher_events_total{outcome=~"failed|succeeded"}[1h])), 1) > 0.2',
              ),
            },
            {
              alert: "GlitterLauncherTelemetryDown",
              for: "10m",
              labels: { severity: "warning" },
              annotations: {
                summary: "Launcher telemetry ingestion is unavailable",
              },
              expr: Expr.fromString(
                'up{namespace="glitter-boys-launcher"} == 0',
              ),
            },
            {
              alert: "GlitterLauncherErrorReporting",
              for: "5m",
              labels: { severity: "warning" },
              annotations: {
                summary: "Launcher errors could not reach Bugsink",
              },
              expr: Expr.fromString(
                "increase(glitter_launcher_reporting_failures_total[15m]) >= 3",
              ),
            },
          ],
        },
      ],
    },
  });
  const panels = [
    [
      "Operation outcomes",
      "sum by (operation, outcome) (increase(glitter_launcher_events_total[1h]))",
    ],
    [
      "Stage duration p95",
      'histogram_quantile(0.95, sum by (le, operation) (rate(glitter_launcher_duration_seconds_bucket{outcome="succeeded"}[1h])))',
    ],
    [
      "Processed bytes",
      "sum by (operation) (increase(glitter_launcher_bytes_total[1h]))",
    ],
    [
      "Launches by release",
      'sum by (release) (increase(glitter_launcher_events_total{operation="startup",outcome="succeeded"}[24h]))',
    ],
  ].map(([title, expr], i) => ({
    id: i + 1,
    type: "timeseries",
    title,
    gridPos: { x: (i % 2) * 12, y: Math.floor(i / 2) * 8, w: 12, h: 8 },
    datasource: { type: "prometheus", uid: "prometheus" },
    targets: [{ refId: "A", expr }],
  }));
  new ConfigMap(chart, "dashboard", {
    metadata: {
      namespace: "prometheus",
      labels: { homelab_grafana_dashboard: "1" },
    },
    data: {
      "glitter-boys-launcher.json": JSON.stringify({
        uid: name,
        title: "Glitter Boys launcher",
        schemaVersion: 39,
        version: 1,
        panels,
      }),
    },
  });
  return chart;
}
