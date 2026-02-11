import { Chart } from "cdk8s";
import {
  KubeClusterRole,
  KubeClusterRoleBinding,
  KubeConfigMap,
  KubeDeployment,
  KubeServiceAccount,
} from "../../../generated/imports/k8s.ts";
import { escapeGoTemplate } from "./monitoring/rules/shared.ts";

const EVENT_EXPORTER_IMAGE = "ghcr.io/resmoio/kubernetes-event-exporter:v1.7";

export function createKubernetesEventExporter(chart: Chart) {
  const namespace = "prometheus";
  const name = "kubernetes-event-exporter";

  // Create ServiceAccount for the event exporter
  new KubeServiceAccount(chart, "event-exporter-sa", {
    metadata: {
      name,
      namespace,
    },
  });

  // Create ClusterRole with permissions to watch events
  new KubeClusterRole(chart, "event-exporter-cluster-role", {
    metadata: {
      name,
    },
    rules: [
      {
        apiGroups: [""],
        resources: ["events"],
        verbs: ["get", "watch", "list"],
      },
    ],
  });

  // Bind the ClusterRole to the ServiceAccount
  new KubeClusterRoleBinding(chart, "event-exporter-cluster-role-binding", {
    metadata: {
      name,
    },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "ClusterRole",
      name,
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name,
        namespace,
      },
    ],
  });

  // Create ConfigMap with the event exporter configuration
  new KubeConfigMap(chart, "event-exporter-config", {
    metadata: {
      name: `${name}-config`,
      namespace,
    },
    data: {
      "config.yaml": escapeGoTemplate(`
logLevel: info
logFormat: json
maxEventAgeSeconds: 60
route:
  routes:
    # Route Warning events to Loki
    - match:
        - receiver: "loki"
      drop:
        # Drop Normal events - only keep Warning
        - type: "Normal"
receivers:
  - name: "loki"
    loki:
      streamLabels:
        app: kubernetes-events
        namespace: "{{ .InvolvedObject.Namespace }}"
        kind: "{{ .InvolvedObject.Kind }}"
        name: "{{ .InvolvedObject.Name }}"
        reason: "{{ .Reason }}"
        type: "{{ .Type }}"
      url: http://loki-gateway.loki:3100/loki/api/v1/push
`),
    },
  });

  // Create the Deployment
  new KubeDeployment(chart, "event-exporter", {
    metadata: {
      name,
      namespace,
      labels: {
        app: name,
      },
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: {
          app: name,
        },
      },
      template: {
        metadata: {
          labels: {
            app: name,
          },
        },
        spec: {
          serviceAccountName: name,
          containers: [
            {
              name: "event-exporter",
              image: EVENT_EXPORTER_IMAGE,
              args: ["-conf=/config/config.yaml"],
              volumeMounts: [
                {
                  name: "config",
                  mountPath: "/config",
                  readOnly: true,
                },
              ],
              securityContext: {
                runAsNonRoot: true,
                readOnlyRootFilesystem: true,
                runAsUser: 65534,
                runAsGroup: 65534,
              },
            },
          ],
          volumes: [
            {
              name: "config",
              configMap: {
                name: `${name}-config`,
              },
            },
          ],
        },
      },
    },
  });
}
