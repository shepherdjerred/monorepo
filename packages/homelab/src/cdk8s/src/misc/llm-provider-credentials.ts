import { ApiObject, Chart, JsonPatch } from "cdk8s";
import type { Deployment } from "cdk8s-plus-31";
import { EnvValue, Secret, type ISecret } from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { loadLlmCredentialItems } from "@shepherdjerred/homelab/scripts/platform-desired-state.ts";

/**
 * Where each workload's OpenTofu-written LLM credentials live. The operator-
 * applied `google` and `anthropic-federation` stacks create one 1Password item
 * per workload; the titles are committed desired state, so the manifests and
 * the stacks cannot disagree. A workload declared there but not yet applied
 * has no item, and its pod waits on the missing Secret rather than starting
 * without a credential.
 */
const ITEMS = loadLlmCredentialItems();

/** Where the kubelet writes the Anthropic-audience projected token. */
const TOKEN_DIRECTORY = "/var/run/secrets/anthropic.com";
const TOKEN_FILE = "token";

/**
 * The kubelet refuses anything shorter, and rotates at 80% of it (~480s). The
 * federation rule mints 1200s tokens, so the SDK's advisory refresh at
 * expiry-120s always finds a fresh, never-exchanged JWT in the file.
 */
const PROJECTED_TOKEN_SECONDS = 600;

/** Anthropic's default expected audience for federated identity tokens. */
const ANTHROPIC_AUDIENCE = "https://api.anthropic.com";

const FEDERATION_KEYS = [
  "ANTHROPIC_ORGANIZATION_ID",
  "ANTHROPIC_FEDERATION_RULE_ID",
  "ANTHROPIC_SERVICE_ACCOUNT_ID",
  "ANTHROPIC_WORKSPACE_ID",
] as const;

function requireTitle(
  titles: Readonly<Record<string, string>>,
  workload: string,
  stack: string,
): string {
  const title = titles[workload];
  if (title === undefined) {
    throw new Error(
      `LLM workload ${workload} is not declared in the ${stack} desired state`,
    );
  }
  return title;
}

const SYNCED = new WeakMap<Chart, Map<string, ISecret>>();

/**
 * Sync one OpenTofu-written item into the chart's namespace, once per chart.
 * The Secret shares the item's title, so a chart that asks twice (Scout's
 * backend and gateway shards) reuses the same objects.
 */
function syncedItem(chart: Chart, title: string): ISecret {
  const synced = SYNCED.get(chart) ?? new Map<string, ISecret>();
  SYNCED.set(chart, synced);
  const existing = synced.get(title);
  if (existing !== undefined) return existing;
  new OnePasswordItem(chart, `llm-credential-${title}`, {
    metadata: { name: title },
    spec: { itemPath: vaultItemPath(title) },
  });
  const secret = Secret.fromSecretName(
    chart,
    `llm-credential-secret-${title}`,
    title,
  );
  synced.set(title, secret);
  return secret;
}

/** The workload's Gemini API key, minted by the `google` stack. */
export function geminiApiKeyEnv(chart: Chart, workload: string): EnvValue {
  return EnvValue.fromSecretValue({
    secret: syncedItem(chart, requireTitle(ITEMS.gemini, workload, "google")),
    key: "GEMINI_API_KEY",
  });
}

/**
 * Give one container an Anthropic identity: a projected service-account token
 * for Anthropic's audience, and the federation identifiers the LLM runtime
 * reads to exchange it, from the item the `anthropic-federation` stack wrote.
 *
 * Patched in because cdk8s-plus has no projected-token volume. The patches
 * append to the pod's existing `volumes` and the container's existing
 * `volumeMounts`; a deployment without either fails synthesis rather than
 * rendering half a credential.
 */
export function addAnthropicFederation(
  deployment: Deployment,
  options: { workload: string; containerIndex?: number },
): void {
  const secretName = syncedItem(
    Chart.of(deployment),
    requireTitle(
      ITEMS.anthropicFederation,
      options.workload,
      "anthropic-federation",
    ),
  ).name;
  const container = `/spec/template/spec/containers/${String(options.containerIndex ?? 0)}`;

  ApiObject.of(deployment).addJsonPatch(
    JsonPatch.add("/spec/template/spec/volumes/-", {
      name: "anthropic-identity",
      projected: {
        sources: [
          {
            serviceAccountToken: {
              audience: ANTHROPIC_AUDIENCE,
              expirationSeconds: PROJECTED_TOKEN_SECONDS,
              path: TOKEN_FILE,
            },
          },
        ],
      },
    }),
    JsonPatch.add(`${container}/volumeMounts/-`, {
      name: "anthropic-identity",
      mountPath: TOKEN_DIRECTORY,
      readOnly: true,
    }),
    ...FEDERATION_KEYS.map((key) =>
      JsonPatch.add(`${container}/env/-`, {
        name: key,
        valueFrom: { secretKeyRef: { name: secretName, key } },
      }),
    ),
    JsonPatch.add(`${container}/env/-`, {
      name: "ANTHROPIC_IDENTITY_TOKEN_FILE",
      value: `${TOKEN_DIRECTORY}/${TOKEN_FILE}`,
    }),
  );
}
