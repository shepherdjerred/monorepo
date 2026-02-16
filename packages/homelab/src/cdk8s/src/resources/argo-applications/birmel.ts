import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";

export function createBirmelApp(chart: Chart) {
  return new Application(chart, "birmel-app", {
    metadata: {
      name: "birmel",
      annotations: {
        "argocd-image-updater.argoproj.io/image-list": "birmel=ghcr.io/shepherdjerred/birmel",
        "argocd-image-updater.argoproj.io/birmel.update-strategy": "semver",
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
        chart: "birmel",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "birmel",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
