import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";

export function createMcpGatewayApp(chart: Chart) {
  return new Application(chart, "mcp-gateway-app", {
    metadata: {
      name: "mcp-gateway",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~1.0.0-0",
        chart: "mcp-gateway",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "mcp-gateway",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true", "Replace=true"],
      },
    },
  });
}
