import type { Chart } from "cdk8s";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { KubeServiceAccount } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";

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
 * Per-step credential boundary, carried over from the Buildkite stack.
 *
 * Each entry becomes one Kubernetes Secret in the CI namespace, synced by the
 * 1Password operator. Steps reference exact keys through
 * `backend_options.kubernetes.secrets`, so a step receives only the values its
 * grant names — the same boundary the Buildkite pipeline enforced with
 * `secretKeyRef`, and the reason credentials never enter Woodpecker's own
 * secret store or database.
 *
 * Item IDs are unchanged from the Buildkite stack; only the Secret names lose
 * their `buildkite-` prefix.
 */
const CI_CREDENTIAL_ITEMS = [
  { secretName: "ci-github-credentials", itemId: "34gzcrhwdm34lpadyly3rcsu44" },
  {
    secretName: "ci-turbo-cache-credentials",
    itemId: "mzvcz4pqqbda75ufu7l5myd4ey",
  },
  { secretName: "ci-npm-credentials", itemId: "4fmd5otmvwcpsrxjaptrloppvu" },
  {
    secretName: "ci-release-openrouter-credentials",
    itemId: "2r6nqphyvaegtnbjgcg4avff3m",
  },
  { secretName: "ci-trmnl-credentials", itemId: "p7th6tqeel7k2sm47mrrto7oca" },
  {
    secretName: "ci-chartmuseum-credentials",
    itemId: "cnutkdwa7uka5hk3wx5gimyfom",
  },
  { secretName: "ci-argocd-credentials", itemId: "xyytntqvtchctebb3ugoiub7u4" },
  {
    secretName: "ci-seaweedfs-credentials",
    itemId: "eyfsbfkxojth6ymr65l47yyfxy",
  },
  {
    secretName: "ci-cloudflare-credentials",
    itemId: "djl2blalora2unjogqnsadlokq",
  },
  {
    secretName: "ci-tailscale-credentials",
    itemId: "eoqdhvwgu7rjfqe6dknexihitu",
  },
  { secretName: "ci-arr-credentials", itemId: "vkzv5jm2euzb7727x6uxdpwu5y" },
  {
    secretName: "openai-tofu-credentials",
    itemId: "jkqhgshctzikhed3vwgogtkmuy",
  },
  {
    secretName: "anthropic-tofu-credentials",
    itemId: "a3limlclcej76wmf3kftiqex4u",
  },
  {
    secretName: "discord-tofu-credentials",
    itemId: "z2tt5eswusadzfsztg4uwr6vay",
  },
  {
    secretName: "openrouter-tofu-credentials",
    itemId: "msklmk7gk2r3rq4kyeywpuafny",
  },
  {
    secretName: "cloudflare-tokens-tofu-credentials",
    itemId: "rzxdklctncniksfcywoypt3fs4",
  },
  {
    secretName: "posthog-tofu-credentials",
    itemId: "yh3xvqemmr4ic2up5zluo2rkcq",
  },
  {
    secretName: "discord-birmel-credentials",
    itemId: "w5c27dzybxor3j6dzl7lub2soe",
  },
  {
    secretName: "discord-starlight-beta-credentials",
    itemId: "tdxe6cq7ozhv7cesfvnlkl5gh4",
  },
  {
    secretName: "discord-starlight-prod-credentials",
    itemId: "cmp6si6n5syhr4smxew3qfcmfi",
  },
  {
    secretName: "discord-scout-beta-credentials",
    itemId: "rtu44pohnp5ixdp2njuv5f6t2e",
  },
  {
    secretName: "discord-scout-prod-credentials",
    itemId: "pacrc4wfbtct4y3qazkvazop5a",
  },
  {
    secretName: "discord-minecraft-credentials",
    itemId: "q37vet77dfggoqbvu4bqle3gje",
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

  for (const { secretName, itemId } of CI_CREDENTIAL_ITEMS) {
    new OnePasswordItem(chart, secretName, {
      spec: { itemPath: vaultItemPath(itemId) },
      metadata: { name: secretName, namespace: WOODPECKER_CI_NAMESPACE },
    });
  }

  // Step pods run under a tokenless identity. Woodpecker's backend never needs
  // the Kubernetes API from inside a step, and mounting a token would hand
  // every pipeline the agent's cluster access.
  new KubeServiceAccount(chart, "woodpecker-job", {
    metadata: { name: "woodpecker-job", namespace: WOODPECKER_CI_NAMESPACE },
    automountServiceAccountToken: false,
  });
}
