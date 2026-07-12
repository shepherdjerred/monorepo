import type { Chart } from "cdk8s";
import type { Deployment } from "cdk8s-plus-31";
import { Service } from "cdk8s-plus-31";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";

export function createTemporalWorkerGithubWebhookService(
  chart: Chart,
  deployment: Deployment,
) {
  // Service + Cloudflare Tunnel binding for the GitHub webhook receiver
  // (Hono server on :9466). Public URL: https://pr-bot.sjer.red — register
  // this URL with the GitHub repo webhook (events: pull_request).
  const webhookService = new Service(
    chart,
    "temporal-worker-gh-webhook-service",
    {
      metadata: {
        name: "temporal-worker-gh-webhook",
        labels: { app: "temporal-worker-gh-webhook" },
      },
      selector: deployment,
      ports: [{ name: "gh-webhook", port: 9466, targetPort: 9466 }],
    },
  );

  createCloudflareTunnelBinding(chart, "temporal-worker-gh-webhook-cf-tunnel", {
    serviceName: webhookService.name,
    subdomain: "pr-bot",
    port: 9466,
    // POST-only webhook receiver — an HTTP probe hitting GET / would 404/405
    // even when healthy, so just check the port accepts a connection.
    probeModule: "tcp_connect",
    publicProbeModule: "tcp_connect",
  });
}

export function createAgentTaskApiService(
  chart: Chart,
  deployment: Deployment,
) {
  const agentTaskService = new Service(
    chart,
    "temporal-worker-agent-task-service",
    {
      metadata: {
        name: "temporal-worker-agent-tasks",
        labels: { app: "temporal-worker-agent-tasks" },
      },
      selector: deployment,
      ports: [{ name: "agent-tasks", port: 9467, targetPort: 9467 }],
    },
  );

  createCloudflareTunnelBinding(chart, "temporal-worker-agent-task-cf-tunnel", {
    serviceName: agentTaskService.name,
    subdomain: "temporal-agent-tasks",
    port: 9467,
    // POST-only receiver — see the gh-webhook probe comment above.
    probeModule: "tcp_connect",
    publicProbeModule: "tcp_connect",
  });
}

export function createXcodeCloudWebhookService(
  chart: Chart,
  deployment: Deployment,
) {
  // Service + Cloudflare Tunnel binding for the Xcode Cloud webhook receiver
  // (Hono server on :9468). Public URL: https://xcode-cloud-webhook.sjer.red —
  // register this URL (with the secret token path) in App Store Connect →
  // Xcode Cloud → Settings → Webhooks. The receiver translates iOS
  // build-failure webhooks into Alertmanager alerts.
  const webhookService = new Service(
    chart,
    "temporal-worker-xcode-cloud-webhook-service",
    {
      metadata: {
        name: "temporal-worker-xcode-cloud-webhook",
        labels: { app: "temporal-worker-xcode-cloud-webhook" },
      },
      selector: deployment,
      ports: [{ name: "xc-webhook", port: 9468, targetPort: 9468 }],
    },
  );

  createCloudflareTunnelBinding(
    chart,
    "temporal-worker-xcode-cloud-webhook-cf-tunnel",
    {
      serviceName: webhookService.name,
      subdomain: "xcode-cloud-webhook",
      port: 9468,
      // POST-only receiver — see the gh-webhook probe comment above.
      probeModule: "tcp_connect",
      publicProbeModule: "tcp_connect",
    },
  );
}
