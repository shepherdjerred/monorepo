import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { Application } from "../../../generated/imports/argoproj.io.ts";
import versions from "../../versions.ts";
import type { HelmValuesForChart } from "../../misc/typed-helm-parameters.ts";

// NodePort for mc-router to accept all Minecraft connections
const MC_ROUTER_NODE_PORT = 30000;

export function createMcRouterApp(chart: Chart) {
  // Create namespace
  new Namespace(chart, "mc-router-namespace", {
    metadata: {
      name: "mc-router",
    },
  });

  const mcRouterValues: HelmValuesForChart<"mc-router"> = {
    services: {
      minecraft: {
        type: "NodePort",
        port: 25565,
        nodePort: MC_ROUTER_NODE_PORT,
      },
    },
    minecraftRouter: {
      // Enable auto-scale up: wake servers when players connect
      autoScale: {
        up: {
          enabled: true,
        },
        // Enable auto-scale down: hibernate servers after idle period
        down: {
          enabled: true,
          after: "10m",
        },
      },
      // Enable prometheus metrics for monitoring
      metrics: {
        backend: "prometheus",
      },
      // Increase connection rate limit for multiple players joining simultaneously
      connectionRateLimit: 10,
    },
    resources: {
      requests: {
        memory: "64Mi",
        cpu: "50m",
      },
      limits: {
        memory: "128Mi",
      },
    },
  };

  // DNS records (SRV, CNAME) are managed by OpenTofu (src/tofu/cloudflare/)
  // DDNS-related records (mc.sjer.red, shuxin.sjer.red, mc.ts-mc.net) are excluded from tofu

  return new Application(chart, "mc-router-app", {
    metadata: {
      name: "mc-router",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://itzg.github.io/minecraft-server-charts/",
        targetRevision: versions["mc-router"],
        chart: "mc-router",
        helm: {
          valuesObject: mcRouterValues,
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "mc-router",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
