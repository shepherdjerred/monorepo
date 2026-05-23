import {
  ConfigMap,
  Cpu,
  Deployment,
  DeploymentStrategy,
  Service,
  Volume,
} from "cdk8s-plus-31";
import type { Chart } from "cdk8s";
import { Duration, Size } from "cdk8s";
import {
  withCommonProps,
  setRevisionHistoryLimit,
} from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import { Probe } from "cdk8s-plus-31";
import { match } from "ts-pattern";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { createCloudflareTunnelBinding } from "@shepherdjerred/homelab/cdk8s/src/misc/cloudflare-tunnel.ts";
import type { Stage } from "@shepherdjerred/homelab/cdk8s/src/cdk8s-charts/scout.ts";

/**
 * Scout web UI deployment: a Caddy container serving the React SPA at
 * /app/* and reverse-proxying /trpc/* + /api/* to the scout backend.
 *
 * Routing is path-based on a single hostname (scout-for-lol.com for
 * prod, scout-for-lol-beta.sjer.red for beta) so cookies stay
 * same-origin and SameSite=Strict works as advertised.
 */
export function createScoutAppDeployment(chart: Chart, stage: Stage) {
  const { image, backendService } = match(stage)
    .with("beta", () => ({
      image: `ghcr.io/shepherdjerred/scout-app:${versions["shepherdjerred/scout-app/beta"]}`,
      backendService: "scout-service-beta",
    }))
    .with("prod", () => ({
      image: `ghcr.io/shepherdjerred/scout-app:${versions["shepherdjerred/scout-app/prod"]}`,
      backendService: "scout-service-prod",
    }))
    .exhaustive();

  // Caddyfile that fronts both the SPA and the backend. Single-origin
  // serving keeps the JWT cookie + CSRF flow simple (no CORS).
  //
  // Order matters in Caddy 2: matchers are evaluated top-down.
  const caddyfile = `{
\tauto_https off
}

:80 {
\thandle_path /trpc* {
\t\treverse_proxy ${backendService}:3000 {
\t\t\theader_up Host {host}
\t\t\theader_up X-Forwarded-Proto https
\t\t}
\t\trewrite * /trpc{path}
\t}

\thandle /api/* {
\t\treverse_proxy ${backendService}:3000 {
\t\t\theader_up Host {host}
\t\t\theader_up X-Forwarded-Proto https
\t\t}
\t}

\thandle /app/* {
\t\troot * /var/www
\t\ttry_files {path} /app/index.html
\t\tfile_server
\t}

\thandle / {
\t\tredir /app/ 302
\t}

\thandle {
\t\trespond "Not Found" 404
\t}
}
`;

  const configMap = new ConfigMap(chart, `scout-app-caddyfile-${stage}`, {
    metadata: { name: `scout-app-caddyfile-${stage}` },
    data: { Caddyfile: caddyfile },
  });

  const caddyfileVolume = Volume.fromConfigMap(
    chart,
    `scout-app-caddyfile-volume-${stage}`,
    configMap,
    { name: "caddyfile", items: { Caddyfile: { path: "Caddyfile" } } },
  );

  const dataVolume = Volume.fromEmptyDir(
    chart,
    `scout-app-caddy-data-${stage}`,
    "caddy-data",
  );
  const configVolume = Volume.fromEmptyDir(
    chart,
    `scout-app-caddy-config-${stage}`,
    "caddy-config",
  );

  const deployment = new Deployment(chart, `scout-app-${stage}`, {
    replicas: 1,
    strategy: DeploymentStrategy.rollingUpdate(),
    metadata: {
      name: `scout-app-${stage}`,
      annotations: {
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "Caddy needs writable filesystem for runtime data",
      },
    },
  });

  const container = deployment.addContainer(
    withCommonProps({
      image,
      portNumber: 80,
      securityContext: {
        readOnlyRootFilesystem: false,
        user: 1000,
        group: 1000,
      },
      // Caddy serving static assets + reverse proxy is cheap.
      // Requests sized below to fit one replica comfortably; limits
      // capped so a runaway reverse-proxy loop can't starve the node.
      resources: {
        cpu: {
          request: Cpu.millis(20),
          limit: Cpu.millis(500),
        },
        memory: {
          request: Size.mebibytes(32),
          limit: Size.mebibytes(128),
        },
      },
      startup: Probe.fromHttpGet("/app/", {
        port: 80,
        periodSeconds: Duration.seconds(5),
        failureThreshold: 30,
      }),
      readiness: Probe.fromHttpGet("/app/", {
        port: 80,
        periodSeconds: Duration.seconds(10),
        failureThreshold: 3,
      }),
      liveness: Probe.fromHttpGet("/app/", {
        port: 80,
        periodSeconds: Duration.seconds(30),
        failureThreshold: 3,
      }),
    }),
  );

  container.mount("/etc/caddy", caddyfileVolume);
  container.mount("/data", dataVolume);
  container.mount("/config", configVolume);

  setRevisionHistoryLimit(deployment);

  const service = new Service(chart, `scout-app-service-${stage}`, {
    metadata: {
      name: `scout-app-service-${stage}`,
      labels: { app: "scout-app", stage },
    },
    selector: deployment,
    ports: [{ port: 80, targetPort: 80 }],
  });

  // FQDN literal is repeated here (matching the `match(stage)` above) so the
  // scripts/check-tunnel-dns-coverage.ts script — which scans for literal
  // `fqdn: "…"` strings — can correlate the tunnel with the OpenTofu DNS
  // record. Keep this in sync with the `match(stage)` above.
  if (stage === "prod") {
    createCloudflareTunnelBinding(chart, `scout-app-tunnel-${stage}`, {
      serviceName: service.name,
      fqdn: "scout-for-lol.com",
      disableDnsUpdates: true,
    });
  } else {
    createCloudflareTunnelBinding(chart, `scout-app-tunnel-${stage}`, {
      serviceName: service.name,
      fqdn: "scout-for-lol-beta.sjer.red",
      disableDnsUpdates: true,
    });
  }
}
