import { ApiObject, Chart, JsonPatch } from "cdk8s";
import { ConfigMap, ServiceAccount } from "cdk8s-plus-31";
import type { Deployment } from "cdk8s-plus-31";
import {
  KubeRole,
  KubeRoleBinding,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { forumNativeObservation as recipe } from "@shepherdjerred/ops-model/forum/native-observation.ts";
import stages from "@shepherdjerred/homelab/cdk8s/src/resources/storm-forum/releases.json" with { type: "json" };

const ACTOR = "system:serviceaccount:delivery:delivery-forum-observer";
const POLICY = "delivery-forum-observer.sjer.red";
/** Legacy adoption only: fixed readonly PHP, no generic exec, Secrets or workload mutation. */
export function attachNativeForumReader(deployment: Deployment) {
  const chart = Chart.of(deployment);
  const account = new ServiceAccount(chart, "forum-native-observer", {
    metadata: { name: "delivery-forum-observer" },
    automountToken: false,
  });
  for (const stage of stages.releases) {
    const namespace =
      stage.stage === "prod" ? "storm-forum" : "storm-forum-beta";
    const name = "delivery-forum-observer";
    new KubeRole(chart, `${namespace}-forum-observer-role`, {
      metadata: { name, namespace },
      rules: [
        { apiGroups: [""], resources: ["pods"], verbs: ["get"] },
        { apiGroups: [""], resources: ["pods/exec"], verbs: ["get", "create"] },
        {
          apiGroups: [""],
          resources: ["persistentvolumeclaims"],
          resourceNames: recipe.claims,
          verbs: ["get"],
        },
      ],
    });
    new KubeRoleBinding(chart, `${namespace}-forum-observer-binding`, {
      metadata: { name, namespace },
      roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name },
      subjects: [
        { kind: "ServiceAccount", name: account.name, namespace: "delivery" },
      ],
    });
  }
  new ApiObject(chart, "forum-native-exec-policy", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "ValidatingAdmissionPolicy",
    metadata: {
      name: POLICY,
      namespace: "",
      annotations: { "argocd.argoproj.io/sync-wave": "-30" },
    },
    spec: {
      failurePolicy: "Fail",
      matchConstraints: {
        resourceRules: [
          {
            apiGroups: [""],
            apiVersions: ["v1"],
            operations: ["CONNECT"],
            resources: ["pods/exec"],
            scope: "Namespaced",
          },
        ],
      },
      matchConditions: [
        {
          name: "observer-only",
          expression: `request.userInfo.username == '${ACTOR}'`,
        },
      ],
      validations: [
        {
          expression: `request.namespace in ${JSON.stringify(recipe.namespaces)} && request.name.matches('^storm-forum-web-[a-z0-9-]+$') && object.container == 'php' && object.command == ${JSON.stringify(recipe.command)} && (!has(object.stdin) || !object.stdin) && (!has(object.tty) || !object.tty) && has(object.stdout) && object.stdout && has(object.stderr) && object.stderr`,
          message:
            "Forum observer permits only the fixed readonly installed-runtime recipe",
          reason: "Forbidden",
        },
      ],
    },
  });
  new ApiObject(chart, "forum-native-exec-binding", {
    apiVersion: "admissionregistration.k8s.io/v1",
    kind: "ValidatingAdmissionPolicyBinding",
    metadata: {
      name: POLICY,
      namespace: "",
      annotations: { "argocd.argoproj.io/sync-wave": "-29" },
    },
    spec: { policyName: POLICY, validationActions: ["Deny"] },
  });
  const config = new ConfigMap(chart, "forum-observer-kubeconfig", {
    data: {
      kubeconfig: JSON.stringify({
        apiVersion: "v1",
        kind: "Config",
        clusters: [
          {
            name: "cluster",
            cluster: {
              server: "https://kubernetes.default.svc:443",
              "certificate-authority": "/var/run/delivery-forum/ca.crt",
            },
          },
        ],
        users: [
          {
            name: "observer",
            user: { tokenFile: "/var/run/delivery-forum/token" },
          },
        ],
        contexts: [
          {
            name: "observer",
            context: { cluster: "cluster", user: "observer" },
          },
        ],
        "current-context": "observer",
      }),
    },
  });
  ApiObject.of(deployment).addJsonPatch(
    JsonPatch.add("/spec/template/spec/serviceAccountName", account.name),
    JsonPatch.add("/spec/template/spec/volumes/-", {
      name: "forum-observer",
      projected: {
        defaultMode: 0o440,
        sources: [
          { serviceAccountToken: { path: "token", expirationSeconds: 600 } },
          {
            configMap: {
              name: "kube-root-ca.crt",
              items: [{ key: "ca.crt", path: "ca.crt" }],
            },
          },
          {
            configMap: {
              name: config.name,
              items: [{ key: "kubeconfig", path: "kubeconfig" }],
            },
          },
        ],
      },
    }),
    JsonPatch.add("/spec/template/spec/containers/0/volumeMounts/-", {
      name: "forum-observer",
      mountPath: "/var/run/delivery-forum",
      readOnly: true,
    }),
  );
}
