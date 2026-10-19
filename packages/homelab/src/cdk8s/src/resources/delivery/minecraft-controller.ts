import { firstPartyImageRecipe } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { ApiObject, type Chart } from "cdk8s";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { dnsEgressRule } from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import {
  getPvcBackupLabels,
  getPvcBackupPolicy,
} from "@shepherdjerred/homelab/cdk8s/src/backup-policy/pvc-backup-policy.ts";
import { NVME_STORAGE_CLASS } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/storage-classes.ts";
import { createMinecraftControllerPermissions } from "./minecraft-controller-permissions.ts";
import { createMinecraftControllerGuards } from "./minecraft-controller-guards.ts";

export const MINECRAFT_CONTROLLER_NAMESPACE = "delivery-tsmc-controller";
export const MINECRAFT_VALIDATION_NAMESPACE =
  "minecraft-tsmc-delivery-validation";
export const MINECRAFT_CONTROLLER_NAME = "delivery-tsmc-controller";

/** A durable, closed maintenance capability; its sandbox never receives the controller identity. */
export function createDeliveryMinecraftController(
  chart: Chart,
  items: {
    executorItemId: string;
    registryItemId: string;
    argocdItemId: string;
  },
): void {
  const namespace = MINECRAFT_CONTROLLER_NAMESPACE;
  const name = MINECRAFT_CONTROLLER_NAME;
  const labels = { app: name, component: name };
  for (const target of [namespace, MINECRAFT_VALIDATION_NAMESPACE]) {
    new ApiObject(chart, `${target}-namespace`, {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: {
        name: target,
        namespace: "",
        labels: {
          "pod-security.kubernetes.io/enforce": "restricted",
          ...(target === MINECRAFT_VALIDATION_NAMESPACE
            ? {
                "delivery.shepherdjerred.com/validation-target":
                  "minecraft-tsmc",
              }
            : {}),
        },
      },
    });
    new ApiObject(chart, `${target}-default-account`, {
      apiVersion: "v1",
      kind: "ServiceAccount",
      metadata: { name: "default", namespace: target },
      automountServiceAccountToken: false,
    });
    new OnePasswordItem(chart, `${target}-registry`, {
      metadata: { name: `dockerhub-pull-${target}`, namespace: target },
      type: "kubernetes.io/dockerconfigjson",
      spec: { itemPath: vaultItemPath(items.registryItemId) },
    });
  }
  new ApiObject(chart, `${name}-account`, {
    apiVersion: "v1",
    kind: "ServiceAccount",
    metadata: { name, namespace },
  });
  new OnePasswordItem(chart, `${name}-executor`, {
    metadata: { name: "delivery-executor", namespace },
    spec: { itemPath: vaultItemPath(items.executorItemId) },
  });
  new OnePasswordItem(chart, `${name}-argocd`, {
    metadata: { name: "delivery-argocd", namespace },
    spec: { itemPath: vaultItemPath(items.argocdItemId) },
  });
  const claim = "delivery-tsmc-journal";
  new ApiObject(chart, `${name}-journal`, {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name: claim,
      namespace,
      labels: getPvcBackupLabels(getPvcBackupPolicy(namespace, claim)),
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      storageClassName: NVME_STORAGE_CLASS,
      volumeMode: "Filesystem",
      resources: { requests: { storage: "2Gi" } },
    },
  });
  new ApiObject(chart, `${name}-server`, {
    apiVersion: "apps/v1",
    kind: "StatefulSet",
    metadata: { name, namespace },
    spec: {
      serviceName: name,
      replicas: 1,
      revisionHistoryLimit: 3,
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: {
          serviceAccountName: name,
          automountServiceAccountToken: true,
          enableServiceLinks: false,
          terminationGracePeriodSeconds: 120,
          securityContext: {
            runAsUser: 1000,
            runAsGroup: 1000,
            runAsNonRoot: true,
            fsGroup: 1000,
            seccompProfile: { type: "RuntimeDefault" },
          },
          imagePullSecrets: [{ name: `dockerhub-pull-${namespace}` }],
          containers: [
            {
              name: "controller",
              image: firstPartyImageRecipe("temporal-worker"),
              command: ["bun", "scripts/jobs/minecraft-controller.ts"],
              ports: [{ name: "http", containerPort: 7356 }],
              securityContext: {
                readOnlyRootFilesystem: true,
                allowPrivilegeEscalation: false,
                capabilities: { drop: ["ALL"] },
              },
              env: [
                { name: "HOME", value: "/journal/home" },
                {
                  name: "NODE_EXTRA_CA_CERTS",
                  value: "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
                },
                {
                  name: "DELIVERY_API_URL",
                  value: "http://delivery.delivery.svc.cluster.local:7353",
                },
                {
                  name: "DELIVERY_EXECUTOR_TOKEN",
                  valueFrom: {
                    secretKeyRef: {
                      name: "delivery-executor",
                      key: "DELIVERY_EXECUTOR_TOKEN",
                    },
                  },
                },
                {
                  name: "ARGOCD_AUTH_TOKEN",
                  valueFrom: {
                    secretKeyRef: {
                      name: "delivery-argocd",
                      key: "ARGOCD_TOKEN",
                    },
                  },
                },
              ],
              volumeMounts: [
                { name: "journal", mountPath: "/journal" },
                { name: "temporary", mountPath: "/tmp" },
              ],
              resources: {
                requests: { cpu: "50m", memory: "128Mi" },
                limits: { cpu: "1", memory: "512Mi" },
              },
              readinessProbe: {
                httpGet: { path: "/healthz", port: "http" },
                periodSeconds: 5,
              },
              startupProbe: {
                httpGet: { path: "/healthz", port: "http" },
                periodSeconds: 5,
                failureThreshold: 24,
              },
            },
          ],
          volumes: [
            { name: "journal", persistentVolumeClaim: { claimName: claim } },
            { name: "temporary", emptyDir: { sizeLimit: "1Gi" } },
          ],
        },
      },
    },
  });
  new ApiObject(chart, `${name}-service`, {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name, namespace },
    spec: {
      selector: labels,
      ports: [{ name: "http", port: 7356, targetPort: "http" }],
    },
  });
  createMinecraftControllerPermissions(chart);
  createMinecraftControllerGuards(chart);
  createControllerNetwork(chart, labels);
}

function createControllerNetwork(chart: Chart, labels: Record<string, string>) {
  const namespace = MINECRAFT_CONTROLLER_NAMESPACE;
  const name = MINECRAFT_CONTROLLER_NAME;
  new KubeNetworkPolicy(chart, `${name}-network`, {
    metadata: { namespace },
    spec: {
      podSelector: { matchLabels: labels },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "temporal" },
              },
              podSelector: { matchLabels: { component: "delivery-worker" } },
            },
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "delivery" },
              },
              podSelector: { matchLabels: { app: "delivery" } },
            },
          ],
          ports: [{ protocol: "TCP", port: IntOrString.fromNumber(7356) }],
        },
      ],
      egress: [
        dnsEgressRule(),
        {
          ports: [
            { protocol: "TCP", port: IntOrString.fromNumber(443) },
            { protocol: "TCP", port: IntOrString.fromNumber(6443) },
          ],
        },
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "delivery" },
              },
              podSelector: { matchLabels: { app: "delivery" } },
            },
          ],
          ports: [{ protocol: "TCP", port: IntOrString.fromNumber(7353) }],
        },
      ],
    },
  });
}
