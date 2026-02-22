import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { Namespace } from "cdk8s-plus-31";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { KubeRoleBinding } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";

export function createBuildkiteApp(chart: Chart) {
  new Namespace(chart, "buildkite-namespace", {
    metadata: {
      name: "buildkite",
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
        "pod-security.kubernetes.io/audit": "privileged",
        "pod-security.kubernetes.io/warn": "privileged",
      },
    },
  });

  new OnePasswordItem(chart, "buildkite-agent-token", {
    spec: {
      itemPath:
        "vaults/v64ocnykdqju4ui6j6pua56xw4/items/z6teegxas67bzggqdjco4pssje",
    },
    metadata: {
      name: "buildkite-agent-token",
      namespace: "buildkite",
    },
  });

  new OnePasswordItem(chart, "buildkite-ci-secrets", {
    spec: {
      itemPath:
        "vaults/v64ocnykdqju4ui6j6pua56xw4/items/rzk3lawpk4yspyyu5rxlz44ssi",
    },
    metadata: {
      name: "buildkite-ci-secrets",
      namespace: "buildkite",
    },
  });

  // ArgoCD token managed by OpenTofu (tofu/argocd module)
  // Update the item ID after running `tofu apply` and getting the output UUID
  new OnePasswordItem(chart, "buildkite-argocd-token", {
    spec: {
      itemPath: vaultItemPath("PLACEHOLDER_REPLACE_WITH_TOFU_OUTPUT"),
    },
    metadata: {
      name: "buildkite-argocd-token",
      namespace: "buildkite",
    },
  });

  new Application(chart, "buildkite-app", {
    metadata: {
      name: "buildkite",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "ghcr.io/buildkite/helm",
        chart: "agent-stack-k8s",
        targetRevision: versions["agent-stack-k8s"],
        helm: {
          valuesObject: {
            agentStackSecret: "buildkite-agent-token",
            config: {
              queue: "default",
              "pod-spec-patch": {
                serviceAccountName: "buildkite-agent-stack-k8s-controller",
                automountServiceAccountToken: true,
              },
            },
          },
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "buildkite",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true", "ServerSideApply=true"],
      },
    },
  });

  // Grant Buildkite ServiceAccount access to pods in dagger namespace
  new KubeRoleBinding(chart, "dagger-buildkite-access-binding", {
    metadata: {
      name: "dagger-buildkite-access-binding",
      namespace: "dagger",
    },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: "dagger-access",
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: "buildkite-agent-stack-k8s-controller",
        namespace: "buildkite",
      },
    ],
  });
}
