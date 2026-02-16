import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";

export function createScoutBetaApp(chart: Chart) {
  return new Application(chart, "scout-beta-app", {
    metadata: {
      name: "scout-beta",
      annotations: {
        "argocd-image-updater.argoproj.io/image-list": "scout=ghcr.io/shepherdjerred/scout-for-lol",
        "argocd-image-updater.argoproj.io/scout.update-strategy": "semver",
        "argocd-image-updater.argoproj.io/write-back-method": "git:secret:argocd/image-updater-git-creds",
        "argocd-image-updater.argoproj.io/git-branch": "main",
      },
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~1.0.0-0",
        chart: "scout-beta",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "scout-beta",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
