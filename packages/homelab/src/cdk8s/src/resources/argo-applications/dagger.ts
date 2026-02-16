import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";
import versions from "../../versions.ts";
import { Namespace } from "cdk8s-plus-31";
import { Size } from "cdk8s";
import { KubeRole, KubeRoleBinding } from "../../../generated/imports/k8s.ts";
import { repositories } from "./actions-runner-controller.ts";
import { NVME_STORAGE_CLASS } from "../../misc/storage-classes.ts";

export function createDaggerApp(chart: Chart) {
  new Namespace(chart, "dagger-namespace", {
    metadata: {
      name: "dagger",
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
      },
    },
  });

  // Grant arc-runners ServiceAccounts access to pods in dagger namespace
  new KubeRole(chart, "dagger-gha-access-role", {
    metadata: { name: "dagger-gha-access", namespace: "dagger" },
    rules: [
      {
        apiGroups: [""],
        resources: ["pods", "pods/exec", "pods/log"],
        verbs: ["get", "list", "watch", "create", "delete", "patch"],
      },
    ],
  });

  // Create role bindings for each repository's ServiceAccount
  repositories.forEach((repo) => {
    new KubeRoleBinding(chart, `dagger-gha-access-binding-${repo.name}`, {
      metadata: {
        name: `dagger-gha-access-binding-${repo.name}`,
        namespace: "dagger",
      },
      roleRef: {
        apiGroup: "rbac.authorization.k8s.io",
        kind: "Role",
        name: "dagger-gha-access",
      },
      subjects: [
        {
          kind: "ServiceAccount",
          name: `${repo.name}-runner-set-gha-rs-no-permission`,
          namespace: "arc-runners",
        },
      ],
    });
  });

  // Grant Coder default ServiceAccount access to pods in dagger namespace
  new KubeRoleBinding(chart, "dagger-coder-access-binding", {
    metadata: {
      name: "dagger-coder-access-binding",
      namespace: "dagger",
    },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: "dagger-gha-access",
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: "default",
        namespace: "coder",
      },
    ],
  });

  new Application(chart, "dagger-app", {
    metadata: {
      name: "dagger",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "registry.dagger.io",
        chart: "dagger-helm",
        targetRevision: versions["dagger-helm"],
        helm: {
          // TODO: use types for this
          valuesObject: {
            engine: {
              image: {
                ref: `ghcr.io/shepherdjerred/dagger-engine:v${versions.dagger}`,
              },
              // Configure GC to prevent disk from filling up (1TB volume)
              configJson: JSON.stringify({
                gc: {
                  maxUsedSpace: "800GB",
                  reservedSpace: "100GB",
                  minFreeSpace: "15%",
                },
              }),
              // Use StatefulSet instead of DaemonSet to enable PVC support
              kind: "StatefulSet",
              statefulSet: {
                persistentVolumeClaim: {
                  enabled: true,
                  storageClassName: NVME_STORAGE_CLASS,
                  accessModes: ["ReadWriteOnce"],
                  resources: {
                    requests: {
                      storage: Size.tebibytes(1).asString(),
                    },
                  },
                },
              },
              // Disable hostPath when using PVC
              hostPath: {
                dataVolume: {
                  enabled: false,
                },
              },
              // OpenTelemetry configuration to export traces to Tempo and logs to Loki
              env: [
                {
                  name: "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
                  value: "http://tempo.tempo.svc:4318/v1/traces",
                },
                {
                  name: "OTEL_EXPORTER_OTLP_PROTOCOL",
                  value: "http/protobuf",
                },
                {
                  name: "OTEL_SERVICE_NAME",
                  value: "dagger-ci",
                },
                {
                  name: "OTEL_LOGS_EXPORTER",
                  value: "otlp",
                },
                {
                  name: "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
                  value: "http://loki.loki.svc:3100/otlp/v1/logs",
                },
              ],
            },
          },
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "dagger",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
