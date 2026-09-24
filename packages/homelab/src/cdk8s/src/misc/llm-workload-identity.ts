import { ApiObject, JsonPatch } from "cdk8s";
import type { Deployment } from "cdk8s-plus-31";
import inventoryJson from "./llm-workload-identity.json" with { type: "json" };
import {
  LlmWorkloadIdentitySchema,
  type LlmWorkloadIdentity,
} from "@shepherdjerred/homelab/scripts/tofu/llm-workload-identity-schema.ts";

/**
 * Where the Anthropic workload-identity federation identifiers live once the
 * operator-applied `anthropic-federation` OpenTofu stack has created them.
 *
 * None of these are secrets — a token can only be minted by presenting a JWT
 * from the trusted issuer whose claims match the rule — so they are committed
 * rather than routed through 1Password. After an apply, the operator refreshes
 * this file with
 * `bun scripts/tofu/tofu-stack.ts anthropic-federation export-workload-identity`.
 *
 * Until a workload appears here it simply has no Anthropic credentials, and the
 * LLM runtime refuses loudly the first time it is asked for a Claude model.
 * Every default model today is OpenAI or Gemini, so that is the correct state
 * before federation exists rather than a silent gap.
 */
const INVENTORY = LlmWorkloadIdentitySchema.parse(inventoryJson);

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

/**
 * Give one container an Anthropic identity: a projected service-account token
 * for Anthropic's audience, and the environment the LLM runtime reads to
 * exchange it.
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
  const identity = INVENTORY.anthropic.workloads[options.workload];
  const organizationId = INVENTORY.anthropic.organization_id;
  if (identity === undefined || organizationId === null) return;

  const container = `/spec/template/spec/containers/${String(options.containerIndex ?? 0)}`;
  const env = {
    ANTHROPIC_FEDERATION_RULE_ID: identity.federation_rule_id,
    ANTHROPIC_SERVICE_ACCOUNT_ID: identity.service_account_id,
    ANTHROPIC_WORKSPACE_ID: identity.workspace_id,
    ANTHROPIC_ORGANIZATION_ID: organizationId,
    ANTHROPIC_IDENTITY_TOKEN_FILE: `${TOKEN_DIRECTORY}/${TOKEN_FILE}`,
  };

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
    ...Object.entries(env).map(([name, value]) =>
      JsonPatch.add(`${container}/env/-`, { name, value }),
    ),
  );
}

export function llmWorkloadIdentityInventory(): LlmWorkloadIdentity {
  return INVENTORY;
}
