import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";
import versions from "../../versions.ts";
import type { HelmValuesForChart } from "../../misc/typed-helm-parameters.ts";
export function createOnePasswordApp(chart: Chart) {
  // TODO: create the 1password secrets here

  const onePasswordValues: HelmValuesForChart<"connect"> = {
    operator: {
      autoRestart: true,
      create: true,
      pollingInterval: 60,
      token: {
        name: "onepassword-token",
        key: "token",
      },
    },
    connect: {
      credentialsName: "op-credentials",
      credentialsKey: "1password-credentials.json",
    },
  };

  return new Application(chart, "1password-app", {
    metadata: {
      name: "1password",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        // https://github.com/1Password/connect-helm-charts
        repoUrl: "https://1password.github.io/connect-helm-charts/",
        targetRevision: versions.connect,
        chart: "connect",
        helm: {
          valuesObject: onePasswordValues,
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "1password",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
