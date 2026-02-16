import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";
import { OnePasswordItem } from "../../../generated/imports/onepassword.com.ts";
import versions from "../../versions.ts";

export function createTailscaleApp(chart: Chart) {
  new OnePasswordItem(chart, "tailscale-operator-oauth-onepassword", {
    spec: {
      itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/mboftvs4fyptyqvg3anrfjy6vu",
    },
    metadata: {
      name: "operator-oauth",
      namespace: "tailscale",
    },
  });

  return new Application(chart, "tailscale-app", {
    metadata: {
      name: "tailscale",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://pkgs.tailscale.com/helmcharts",
        chart: "tailscale-operator",
        targetRevision: versions["tailscale-operator"],
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "tailscale",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
