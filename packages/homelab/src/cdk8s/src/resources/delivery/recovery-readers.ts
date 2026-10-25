import { ApiObject, Chart, JsonPatch } from "cdk8s";
import type { Deployment } from "cdk8s-plus-31";
import {
  KubeRole,
  KubeRoleBinding,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  DELIVERY_API_SERVICE_ACCOUNT as api,
  DELIVERY_KUBERNETES_READERS,
} from "@shepherdjerred/ops-model/delivery-readers.ts";

const TOKEN_SECONDS = 600;

function projection(name: string, directory: string, sources: unknown[]) {
  return [
    JsonPatch.add("/spec/template/spec/volumes/-", {
      name,
      projected: { defaultMode: 0o440, sources },
    }),
    JsonPatch.add("/spec/template/spec/containers/0/volumeMounts/-", {
      name,
      mountPath: directory,
      readOnly: true,
    }),
  ];
}

/**
 * Delivery's independent settlement readers (model D5, I2, section 8). Each
 * reader's Role grants get, list and watch on exactly what it reads, bound to
 * the API's ServiceAccount; the API container alone receives a short-lived
 * token per reader. Kubernetes projects only the pod's own account, so every
 * reader token carries the account's whole authority; the directories
 * separate use, not authority, and recovery-readers.test.ts pins that
 * complete grant set. Neither the ArgoCD server nor any executor credential is
 * involved.
 */
export function attachDeliveryRecoveryReaders(deployment: Deployment): void {
  const chart = Chart.of(deployment);
  const patches = [];
  for (const reader of Object.values(DELIVERY_KUBERNETES_READERS)) {
    for (const namespace of reader.namespaces) {
      new KubeRole(chart, `${namespace}-${reader.name}-role`, {
        metadata: { name: reader.name, namespace },
        rules: reader.rules.map((rule) => ({
          apiGroups: [...rule.apiGroups],
          resources: [...rule.resources],
          verbs: [...rule.verbs],
        })),
      });
      new KubeRoleBinding(chart, `${namespace}-${reader.name}-binding`, {
        metadata: { name: reader.name, namespace },
        roleRef: {
          apiGroup: "rbac.authorization.k8s.io",
          kind: "Role",
          name: reader.name,
        },
        subjects: [{ kind: "ServiceAccount", ...api }],
      });
    }
    patches.push(
      ...projection(reader.name, reader.directory, [
        {
          serviceAccountToken: {
            path: "token",
            expirationSeconds: TOKEN_SECONDS,
          },
        },
        {
          configMap: {
            name: "kube-root-ca.crt",
            items: [{ key: "ca.crt", path: "ca.crt" }],
          },
        },
      ]),
    );
  }
  ApiObject.of(deployment).addJsonPatch(...patches);
}
