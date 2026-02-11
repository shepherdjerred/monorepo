import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";

export function createStarlightKarmaBotBetaApp(chart: Chart) {
  return new Application(chart, "starlight-karma-bot-beta-app", {
    metadata: {
      name: "starlight-karma-bot-beta",
      annotations: {
        "argocd-image-updater.argoproj.io/image-list": "starlight=ghcr.io/shepherdjerred/starlight-karma-bot",
        "argocd-image-updater.argoproj.io/starlight.update-strategy": "semver",
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
        chart: "starlight-karma-bot-beta",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "starlight-karma-bot-beta",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
