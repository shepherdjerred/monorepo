import type { Chart } from "cdk8s";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
import { helmApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";
export function createOnePasswordApp(chart: Chart) {
  // TODO: create the 1password secrets here

  const onePasswordValues: HelmValuesForChart<"connect"> = {
    operator: {
      autoRestart: true,
      create: true,
      pollingInterval: 60,
      token: {
        name: "onepassword-token",
        key: "TOKEN",
      },
    },
    connect: {
      credentialsName: "op-credentials",
      credentialsKey: "1password-credentials.json",
      // Chart defaults each container to a 200m request; 30d pod peak is ~30m / ~30Mi.
      api: {
        resources: {
          requests: {
            cpu: "25m",
            memory: "64Mi",
          },
        },
      },
      sync: {
        resources: {
          requests: {
            cpu: "25m",
            memory: "64Mi",
          },
        },
      },
    },
  };

  return helmApplication(chart, {
    name: "1password",
    namespace: "1password",
    chart: "connect",
    // https://github.com/1Password/connect-helm-charts
    repoUrl: "https://1password.github.io/connect-helm-charts/",
    targetRevision: versions.connect,
    valuesObject: onePasswordValues,
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
