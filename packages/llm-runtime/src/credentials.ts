import type {
  AnthropicCredentials,
  GoogleCredentials,
  ProviderCredentials,
} from "./types.ts";

/**
 * The environment contract for provider credentials, in one place.
 *
 * Under the gateway every service read a single `OPENROUTER_API_KEY`, so each
 * one carried that field in its own typed config. Three providers with two
 * different authentication models would multiply that by six packages, and the
 * shapes are not application configuration — they are credentials and
 * bootstrap, which is what the environment is for here. Centralizing also
 * gives the deployment manifests and the architecture guard exactly one list of
 * names to agree on.
 *
 * Anthropic resolves to federation whenever the federation variables are
 * present, and to a static key otherwise. That ordering is deliberate and the
 * opposite of the Anthropic SDKs', which rank `ANTHROPIC_API_KEY` highest and
 * so let a leftover key silently shadow a federated workload.
 */
export type CredentialEnv = Readonly<Record<string, string | undefined>>;

function trimmed(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  return candidate === undefined || candidate === "" ? undefined : candidate;
}

function anthropicFromEnv(
  env: CredentialEnv,
): AnthropicCredentials | undefined {
  const identityTokenFile = trimmed(env["ANTHROPIC_IDENTITY_TOKEN_FILE"]);
  const federationRuleId = trimmed(env["ANTHROPIC_FEDERATION_RULE_ID"]);
  const organizationId = trimmed(env["ANTHROPIC_ORGANIZATION_ID"]);
  const serviceAccountId = trimmed(env["ANTHROPIC_SERVICE_ACCOUNT_ID"]);

  const federationFields = {
    ANTHROPIC_IDENTITY_TOKEN_FILE: identityTokenFile,
    ANTHROPIC_FEDERATION_RULE_ID: federationRuleId,
    ANTHROPIC_ORGANIZATION_ID: organizationId,
    ANTHROPIC_SERVICE_ACCOUNT_ID: serviceAccountId,
  };
  const present = Object.entries(federationFields).filter(
    ([, value]) => value !== undefined,
  );

  if (present.length > 0) {
    // A partially-configured federation is a deployment mistake, not a reason
    // to quietly fall back to a static key.
    if (
      identityTokenFile === undefined ||
      federationRuleId === undefined ||
      organizationId === undefined ||
      serviceAccountId === undefined
    ) {
      const missing = Object.entries(federationFields)
        .filter(([, value]) => value === undefined)
        .map(([name]) => name);
      throw new Error(
        `Anthropic federation is partially configured; missing ${missing.join(", ")}`,
      );
    }
    const workspaceId = trimmed(env["ANTHROPIC_WORKSPACE_ID"]);
    return {
      kind: "federation",
      identityTokenFile,
      federationRuleId,
      organizationId,
      serviceAccountId,
      ...(workspaceId === undefined ? {} : { workspaceId }),
    };
  }

  const apiKey = trimmed(env["ANTHROPIC_API_KEY"]);
  return apiKey === undefined ? undefined : { kind: "apiKey", apiKey };
}

function googleFromEnv(env: CredentialEnv): GoogleCredentials | undefined {
  const project =
    trimmed(env["GOOGLE_VERTEX_PROJECT"]) ??
    trimmed(env["GOOGLE_CLOUD_PROJECT"]);
  if (project === undefined) return undefined;
  const location = trimmed(env["GOOGLE_VERTEX_LOCATION"]);
  return { project, ...(location === undefined ? {} : { location }) };
}

/**
 * Read whichever providers this workload is configured for. A provider with no
 * configuration is simply absent; the runtime fails only if a model actually
 * routes there.
 */
export function providerCredentialsFromEnv(
  env: CredentialEnv = Bun.env,
): ProviderCredentials {
  const openaiKey = trimmed(env["OPENAI_API_KEY"]);
  const anthropic = anthropicFromEnv(env);
  const google = googleFromEnv(env);
  return {
    ...(openaiKey === undefined ? {} : { openai: { apiKey: openaiKey } }),
    ...(anthropic === undefined ? {} : { anthropic }),
    ...(google === undefined ? {} : { google }),
  };
}
