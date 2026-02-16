import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";
import { Namespace } from "cdk8s-plus-31";
import versions from "../../versions.ts";
import type { HelmValuesForChart } from "../../misc/typed-helm-parameters.ts";
export function createPostgresOperatorApp(chart: Chart) {
  new Namespace(chart, "postgres-operator-namespace", {
    metadata: {
      name: "postgres-operator",
    },
  });

  const postgresOperatorValues: HelmValuesForChart<"postgres-operator"> = {
    configKubernetes: {
      // Since we have a single-node cluster, reduce resource requirements
      cluster_labels: {
        application: "spilo",
      },
      cluster_name_label: "cluster-name",
      enable_cross_namespace_secret: true,
    },
    configPatroni: {
      // Configure Patroni for single-node setup
      enable_patroni_failsafe_mode: true,
    },
    // Resource configuration for single-node deployment
    resources: {
      limits: {
        cpu: "500m",
        memory: "500Mi",
      },
      requests: {
        cpu: "100m",
        memory: "250Mi",
      },
    },
  };

  return new Application(chart, "postgres-operator-app", {
    metadata: {
      name: "postgres-operator",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        // https://github.com/zalando/postgres-operator
        repoUrl: "https://opensource.zalando.com/postgres-operator/charts/postgres-operator",
        chart: "postgres-operator",
        targetRevision: versions["postgres-operator"],
        helm: {
          valuesObject: postgresOperatorValues,
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "postgres-operator",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
      ignoreDifferences: [
        {
          group: "apiextensions.k8s.io",
          kind: "CustomResourceDefinition",
          jsonPointers: ["/status"],
        },
        {
          group: "acid.zalan.do",
          kind: "OperatorConfiguration",
          jsonPointers: [
            "/status",
            // The operator adds this field at runtime by copying from kubernetes.enable_cross_namespace_secret
            "/configuration/enable_cross_namespace_secret",
          ],
        },
      ],
    },
  });
}
