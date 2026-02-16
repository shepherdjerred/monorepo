import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";
import versions from "../../versions.ts";
import { OnePasswordItem } from "../../../generated/imports/onepassword.com.ts";

export function createArgoCdImageUpdaterApp(chart: Chart) {
  // Git credentials for write-back
  new OnePasswordItem(chart, "image-updater-git-creds", {
    spec: {
      itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/ekicp7e533ahwirkav52ud5qxe",
    },
  });

  return new Application(chart, "argocd-image-updater-app", {
    metadata: {
      name: "argocd-image-updater",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://argoproj.github.io/argo-helm/",
        targetRevision: versions["argocd-image-updater"],
        chart: "argocd-image-updater",
        helm: {
          valuesObject: {
            config: {
              registries: [
                {
                  name: "GitHub Container Registry",
                  prefix: "ghcr.io",
                  api_url: "https://ghcr.io",
                },
              ],
            },
          },
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "argocd",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
