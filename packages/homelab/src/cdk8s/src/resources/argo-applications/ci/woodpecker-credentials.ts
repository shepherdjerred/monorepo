import type { Chart } from "cdk8s";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { KubeServiceAccount } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { dockerHubPullSecretName } from "@shepherdjerred/homelab/cdk8s/src/dockerhub-pull-secrets.ts";

/**
 * The Woodpecker control plane: server, agent, configuration extension, and
 * database. Never Kueue-managed, so a Kueue outage cannot stop any of them
 * from restarting.
 */
export const WOODPECKER_NAMESPACE = "woodpecker";

/**
 * Where CI work runs: every step, clone, and service pod, their workspace
 * claims, the caches they mount, and the credentials they are granted.
 *
 * A namespace of its own because Kueue can only scope pod admission by
 * namespace. Every pod created here is gated until the CI quota admits it,
 * which is exactly right for CI and exactly wrong for the control plane --
 * see `resources/kueue-config.ts`.
 */
export const WOODPECKER_CI_NAMESPACE = "woodpecker-ci";

/**
 * 1Password item backing the Woodpecker server itself.
 *
 * Holds the forge OAuth2 client and secret plus the shared agent secret. This
 * is the only genuinely new credential the migration introduces — every CI
 * credential below already exists and keeps its 1Password item.
 *
 * Woodpecker requires an OAuth2 App rather than a GitHub App: it does not
 * refresh GitHub App user access tokens, so App-issued tokens expire mid
 * session. The repo's existing GITHUB_APP_* credential is unrelated and stays
 * in use for the review gate and PR operations.
 */
export const WOODPECKER_SERVER_ITEM_ID = "covttsojandjk7fx62a3dbk7em";

/**
 * Per-step credential boundary.
 *
 * Each entry becomes one Kubernetes Secret in the CI namespace, synced by the
 * 1Password operator. Steps reference exact keys through
 * `backend_options.kubernetes.secrets`, so a step receives only the values its
 * grant names through `secretKeyRef`. That is also why credentials never enter
 * Woodpecker's own secret store or database.
 *
 * CI has build/publication and repository automation authority only. Handoff
 * and Delivery publication use dedicated minimal items: per-key grants do not
 * prevent an operator from mirroring every field of the backing item. Rotate
 * the publisher token at its issuer/API registration and scoped copy together.
 * GitHub CI and extension mirrors share a six-field CI-only copy. Rotate those
 * fields in the owning GitHub item and this copy together; TOFU_GITHUB_TOKEN
 * remains only in the original item used by platform provider Jobs.
 */
const CI_CREDENTIAL_ITEMS = [
  {
    secretName: "ci-delivery-archive-credentials",
    itemId: "abfkcnjps6pydr4x7gzs76h62i",
  },
  {
    secretName: "ci-delivery-credentials",
    itemId: "mrvxxnlx3rk6dlfmkxgdfqio5e",
  },
  {
    secretName: "ci-seaweedfs-credentials",
    itemId: "quqpki5jgjf4pc5lotdbxxkep4",
  },
  {
    secretName: "dockerhub-pull-woodpecker-ci",
    itemId: "ngzmppq52zm7sii6ato2mv3sbi",
    type: "kubernetes.io/dockerconfigjson",
  },
  {
    secretName: "ci-dockerhub-publisher-credentials",
    itemId: "mqgjqj7xmludkliupnmm2aic6y",
  },
  { secretName: "ci-github-credentials", itemId: "3kwpfoyzu6a7icnm7jg7dn7scy" },
  {
    secretName: "ci-turbo-cache-credentials",
    itemId: "mzvcz4pqqbda75ufu7l5myd4ey",
  },
  { secretName: "ci-npm-credentials", itemId: "4fmd5otmvwcpsrxjaptrloppvu" },
  {
    secretName: "ci-release-openai-credentials",
    itemId: "2r6nqphyvaegtnbjgcg4avff3m",
  },
  {
    secretName: "ci-chartmuseum-credentials",
    itemId: "cnutkdwa7uka5hk3wx5gimyfom",
  },
] as const;

export function createWoodpeckerCredentialBoundaries(chart: Chart): void {
  new OnePasswordItem(chart, "woodpecker-server-credentials", {
    spec: { itemPath: vaultItemPath(WOODPECKER_SERVER_ITEM_ID) },
    metadata: {
      name: "woodpecker-server-credentials",
      namespace: WOODPECKER_NAMESPACE,
    },
  });

  new OnePasswordItem(chart, "woodpecker-extension-github-credentials", {
    spec: { itemPath: vaultItemPath("3kwpfoyzu6a7icnm7jg7dn7scy") },
    metadata: {
      name: "woodpecker-extension-github-credentials",
      namespace: WOODPECKER_NAMESPACE,
    },
  });

  for (const item of CI_CREDENTIAL_ITEMS) {
    new OnePasswordItem(chart, item.secretName, {
      spec: { itemPath: vaultItemPath(item.itemId) },
      metadata: { name: item.secretName, namespace: WOODPECKER_CI_NAMESPACE },
      ...("type" in item ? { type: item.type } : {}),
    });
  }

  // Step pods run under a tokenless identity. Woodpecker's backend never needs
  // the Kubernetes API from inside a step, and mounting a token would hand
  // every pipeline the agent's cluster access.
  new KubeServiceAccount(chart, "woodpecker-job", {
    metadata: { name: "woodpecker-job", namespace: WOODPECKER_CI_NAMESPACE },
    automountServiceAccountToken: false,
    imagePullSecrets: [
      { name: dockerHubPullSecretName(WOODPECKER_CI_NAMESPACE) },
    ],
  });
}
