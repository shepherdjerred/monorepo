import { z } from "zod";
import googleDesiredStateJson from "#tofu/google/desired-state.json" with { type: "json" };
import anthropicFederationDesiredStateJson from "#tofu/anthropic-federation/desired-state.json" with { type: "json" };

export type PlatformStack =
  | "openai"
  | "anthropic"
  | "anthropic-federation"
  | "google"
  | "discord"
  | "cloudflare-tokens";

const SCHEMA_REFERENCE = "../platform-desired-state.schema.json";
const nonEmptyString = z.string().min(1);
const optionalNonEmptyString = nonEmptyString.optional();
const resourceMap = <SCHEMA extends z.ZodType>(schema: SCHEMA) =>
  z.record(nonEmptyString, schema);
const schemaReference = z.literal(SCHEMA_REFERENCE);
// OpenTofu creates these 1Password items and CDK8s references them by title,
// so the title is the contract between the two and lives here once.
const onePasswordItemTitle = z.string().regex(/^[a-z0-9][a-z0-9-]{2,62}$/u);
const onePasswordTarget = z.strictObject({
  vault_item_id: nonEmptyString,
  vault_field: nonEmptyString,
  vault_json_path: optionalNonEmptyString,
});
const onePasswordTargetReference = z.looseObject({
  vault_item_id: nonEmptyString,
  vault_field: optionalNonEmptyString,
  vault_json_path: optionalNonEmptyString,
});
export type OnePasswordTarget = {
  vault_item_id: string;
  vault_field?: string;
  vault_json_path?: string;
};

const openAiProject = z.strictObject({
  project_id: optionalNonEmptyString,
  name: nonEmptyString,
  geography: optionalNonEmptyString,
  external_key_id: optionalNonEmptyString,
});
const openAiServiceAccount = z.strictObject({
  project_key: nonEmptyString,
  name: nonEmptyString,
  onepassword_targets: z.array(onePasswordTarget).min(1),
});
const openAiOrganizationUser = z.strictObject({
  user_id: nonEmptyString,
  role: optionalNonEmptyString,
  developer_persona: optionalNonEmptyString,
  technical_level: optionalNonEmptyString,
});
const openAiProjectUser = z.strictObject({
  project_key: nonEmptyString,
  user_id: nonEmptyString,
  role_id: nonEmptyString,
});
const spendAlert = z.strictObject({
  threshold_amount: z.number(),
  currency: nonEmptyString,
  interval: nonEmptyString,
  notification_channel_type: nonEmptyString,
  notification_channel_recipients: z.array(nonEmptyString),
  notification_channel_subject_prefix: optionalNonEmptyString,
});
const openAiGroup = z.strictObject({
  group_id: nonEmptyString,
  name: nonEmptyString,
});
const openAiGroupUser = z.strictObject({
  group_key: nonEmptyString,
  user_id: nonEmptyString,
});
const openAiGroupRole = z.strictObject({
  group_key: nonEmptyString,
  role_id: nonEmptyString,
});
const openAiUserRole = z.strictObject({
  user_id: nonEmptyString,
  role_id: nonEmptyString,
});
const openAiRole = z.strictObject({
  role_name: nonEmptyString,
  permissions: z.array(nonEmptyString),
  description: optionalNonEmptyString,
});
const openAiCertificate = z.strictObject({
  certificate_id: nonEmptyString,
  name: optionalNonEmptyString,
});
const spendLimit = z.strictObject({
  threshold_amount: z.number(),
  currency: nonEmptyString,
  interval: nonEmptyString,
});
const openAiProjectGroup = z.strictObject({
  project_key: nonEmptyString,
  group_key: nonEmptyString,
  role: nonEmptyString,
});
const openAiProjectGroupRole = z.strictObject({
  project_key: nonEmptyString,
  group_key: nonEmptyString,
  role_id: nonEmptyString,
});
const openAiProjectDataRetention = z.strictObject({
  project_key: nonEmptyString,
  type: nonEmptyString,
});
const openAiProjectModelPermissions = z.strictObject({
  project_key: nonEmptyString,
  mode: nonEmptyString,
  model_ids: z.array(nonEmptyString),
});
const openAiProjectHostedToolPermissions = z.strictObject({
  project_key: nonEmptyString,
  file_search_enabled: z.boolean(),
  web_search_enabled: z.boolean(),
  image_generation_enabled: z.boolean(),
  mcp_enabled: z.boolean(),
  code_interpreter_enabled: z.boolean(),
});
const openAiProjectRateLimit = z.strictObject({
  project_key: nonEmptyString,
  rate_limit_id: nonEmptyString,
  batch_1_day_max_input_tokens: z.number().optional(),
  max_audio_megabytes_per_1_minute: z.number().optional(),
  max_images_per_1_minute: z.number().optional(),
  max_requests_per_1_day: z.number().optional(),
  max_requests_per_1_minute: z.number().optional(),
  max_tokens_per_1_minute: z.number().optional(),
});

const openAiDesiredState = z.strictObject({
  $schema: schemaReference,
  platform: z.literal("openai"),
  openai_projects: resourceMap(openAiProject),
  openai_service_accounts: resourceMap(openAiServiceAccount),
  openai_organization_users: resourceMap(openAiOrganizationUser),
  openai_project_users: resourceMap(openAiProjectUser),
  // Project-scoped alerts carry the project they bind to, exactly like
  // `openai_project_spend_limits` below; the organization-scoped maps do not.
  // This stayed wrong until the first project alert was declared because an
  // empty map validates against either shape.
  openai_project_spend_alerts: resourceMap(
    spendAlert.extend({ project_key: nonEmptyString }),
  ),
  openai_groups: resourceMap(openAiGroup),
  openai_group_users: resourceMap(openAiGroupUser),
  openai_group_roles: resourceMap(openAiGroupRole),
  openai_user_roles: resourceMap(openAiUserRole),
  openai_roles: resourceMap(openAiRole),
  openai_certificates: resourceMap(openAiCertificate),
  openai_organization_spend_alerts: resourceMap(spendAlert),
  openai_organization_spend_limits: resourceMap(spendLimit),
  openai_project_groups: resourceMap(openAiProjectGroup),
  openai_project_group_roles: resourceMap(openAiProjectGroupRole),
  openai_project_data_retention: resourceMap(openAiProjectDataRetention),
  openai_project_model_permissions: resourceMap(openAiProjectModelPermissions),
  openai_project_hosted_tool_permissions: resourceMap(
    openAiProjectHostedToolPermissions,
  ),
  openai_project_spend_limits: resourceMap(
    spendLimit.extend({ project_key: nonEmptyString }),
  ),
  openai_project_rate_limits: resourceMap(openAiProjectRateLimit),
});

const anthropicDesiredState = z.strictObject({
  $schema: schemaReference,
  platform: z.literal("anthropic"),
  anthropic_workspaces: resourceMap(
    z.strictObject({
      name: nonEmptyString,
      workspace_id: optionalNonEmptyString,
    }),
  ),
  anthropic_api_keys: resourceMap(
    z.strictObject({
      api_key_id: nonEmptyString,
      name: nonEmptyString,
      status: nonEmptyString,
      vault_item_id: nonEmptyString,
      vault_field: nonEmptyString,
      vault_json_path: optionalNonEmptyString,
    }),
  ),
  anthropic_workspace_members: resourceMap(
    z.strictObject({
      workspace_key: nonEmptyString,
      user_id: nonEmptyString,
      workspace_role: nonEmptyString,
    }),
  ),
});

const DISCORD_BOTS = [
  "birmel",
  "starlight-beta",
  "starlight-prod",
  "scout-beta",
  "scout-prod",
  "minecraft",
] as const;
const discordBot = z.strictObject({
  application_name: nonEmptyString,
  expected_application_id: z
    .string()
    .regex(/^\d+$/u, "expected_application_id must be numeric"),
  vault_item_id: nonEmptyString,
  description: z.string().optional(),
  custom_install_url: z.url().optional(),
  interactions_endpoint_url: z.url().optional(),
  role_connections_verification_url: z.url().optional(),
  tags: z.array(z.string()).optional(),
});
const discordDesiredState = z.strictObject({
  $schema: schemaReference,
  platform: z.literal("discord"),
  discord_bots: z
    .record(nonEmptyString, discordBot)
    .superRefine((bots, ctx) => {
      const actual = Object.keys(bots).toSorted();
      const expected = [...DISCORD_BOTS].toSorted();
      if (
        actual.length !== expected.length ||
        actual.some((name, index) => name !== expected[index])
      ) {
        ctx.addIssue({
          code: "custom",
          message: "discord_bots must contain exactly the six configured bots",
        });
      }
    }),
});

const anthropicFederationDesiredState = z.strictObject({
  $schema: schemaReference,
  platform: z.literal("anthropic-federation"),
  anthropic_federation_workspaces: resourceMap(
    z.strictObject({ name: nonEmptyString }),
  ),
  anthropic_federation_issuer: z.strictObject({
    name: z.string().regex(/^[a-z0-9-]+$/u),
    issuer_url: z.string().startsWith("https://"),
    jwks_keys_json: nonEmptyString,
    max_jwt_lifetime_seconds: z.number().int().min(60).max(176_400),
  }),
  anthropic_federation_workloads: resourceMap(
    z.strictObject({
      workspace_key: nonEmptyString,
      namespace: nonEmptyString,
      // Anthropic caps a minted token at twice the remaining assertion
      // lifetime, and projected tokens live 600s, so more than 1200 is never
      // honoured.
      token_lifetime_seconds: z.number().int().min(60).max(1200),
      // The item OpenTofu writes the workload's federation identifiers into.
      onepassword_item_title: onePasswordItemTitle,
    }),
  ),
});

const googleDesiredState = z.strictObject({
  $schema: schemaReference,
  platform: z.literal("google"),
  // Null until the billing account and quota project exist. The stack refuses
  // to plan while either is unset, which is the intended state until then.
  google_billing_account_id: z
    .string()
    .regex(/^[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$/u)
    .nullable(),
  google_quota_project_id: nonEmptyString.nullable(),
  google_workloads: resourceMap(
    z
      .strictObject({
        project_id: z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u),
        display_name: nonEmptyString,
        monthly_budget_usd: z.number().positive(),
        ai_studio_spend_cap_usd: z.number().positive(),
        // Bumping this mints a replacement key before the old one is deleted.
        gemini_key_revision: z.number().int().positive(),
        // The item OpenTofu writes the minted key into, as GEMINI_API_KEY.
        onepassword_item_title: onePasswordItemTitle,
        // Per-model request ceilings, keyed by the Cloud Quotas `model`
        // dimension (which can differ from the API model id). They throttle a
        // runaway immediately; the AI Studio monthly cap is the dollar stop.
        gemini_quota_limits: resourceMap(
          z.strictObject({
            // Omitted leaves Google's default daily limit in place.
            requests_per_day: z.number().int().positive().optional(),
            requests_per_minute: z.number().int().positive(),
          }),
        ),
      })
      .refine(
        (workload) =>
          workload.ai_studio_spend_cap_usd <= workload.monthly_budget_usd,
        {
          message:
            "ai_studio_spend_cap_usd must not exceed monthly_budget_usd, or the budget alert would fire only after the cap should have stopped spend",
        },
      ),
  ),
});

const cloudflareTokenPolicy = z.strictObject({
  effect: nonEmptyString,
  permission_groups: z.array(
    z.strictObject({
      id: nonEmptyString,
      name: nonEmptyString,
    }),
  ),
  resources: z.record(nonEmptyString, nonEmptyString),
});
const cloudflareTokenCondition = z.strictObject({
  request_ip: z
    .strictObject({
      in: z.array(nonEmptyString).optional(),
      not_in: z.array(nonEmptyString).optional(),
    })
    .optional(),
});
const cloudflareToken = z.strictObject({
  supersedes_id: nonEmptyString,
  name: nonEmptyString,
  policies: z.array(cloudflareTokenPolicy),
  condition: cloudflareTokenCondition.optional(),
  expires_on: optionalNonEmptyString,
  not_before: optionalNonEmptyString,
  status: optionalNonEmptyString,
  vault_item_id: nonEmptyString,
  vault_field: nonEmptyString,
  vault_json_path: optionalNonEmptyString,
});
const cloudflareDesiredState = z.strictObject({
  $schema: schemaReference,
  platform: z.literal("cloudflare-tokens"),
  cloudflare_api_tokens: resourceMap(cloudflareToken),
});

function declaredPlatform(value: unknown): PlatformStack {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Platform desired state must be an object");
  }
  const platform = "platform" in value ? value.platform : undefined;
  return z
    .enum([
      "openai",
      "anthropic",
      "anthropic-federation",
      "google",
      "discord",
      "cloudflare-tokens",
    ])
    .parse(platform);
}

function variablesFromDesiredState(
  desiredState: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(desiredState).filter(
      ([name]) => name !== "$schema" && name !== "platform",
    ),
  );
}

/**
 * Collect the 1Password rotation-unit references embedded in a parsed desired
 * state. The platform schemas intentionally keep these references in several
 * resource shapes, so walk the validated value instead of maintaining a
 * second, easy-to-forget list of paths.
 */
export function collectOnePasswordTargets(
  value: unknown,
): readonly OnePasswordTarget[] {
  const targets: OnePasswordTarget[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    const record = z.record(z.string(), z.unknown()).safeParse(node);
    if (!record.success) return;

    const target = onePasswordTargetReference.safeParse(record.data);
    if (target.success) {
      const normalizedTarget: OnePasswordTarget = {
        vault_item_id: target.data.vault_item_id,
      };
      if (target.data.vault_field !== undefined) {
        normalizedTarget.vault_field = target.data.vault_field;
      }
      if (target.data.vault_json_path !== undefined) {
        normalizedTarget.vault_json_path = target.data.vault_json_path;
      }
      targets.push(normalizedTarget);
    }
    for (const child of Object.values(record.data)) visit(child);
  };
  visit(value);
  return targets;
}

/** The 1Password items OpenTofu writes LLM workload credentials into. */
export type LlmCredentialItems = {
  /** Workload key to the item holding its GEMINI_API_KEY. */
  readonly gemini: Readonly<Record<string, string>>;
  /** Workload key to the item holding its Anthropic federation identifiers. */
  readonly anthropicFederation: Readonly<Record<string, string>>;
};

function titlesByWorkload(
  workloads: Readonly<Record<string, { onepassword_item_title: string }>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(workloads).map(([key, workload]) => [
      key,
      workload.onepassword_item_title,
    ]),
  );
}

/**
 * Read, synchronously, which 1Password item each LLM workload's
 * OpenTofu-written credentials live in. CDK8s synthesis is synchronous and
 * offline, and these titles are committed desired state, so the manifests and
 * the stacks cannot disagree about where a credential is.
 */
export function loadLlmCredentialItems(): LlmCredentialItems {
  const google = googleDesiredState.parse(googleDesiredStateJson);
  const federation = anthropicFederationDesiredState.parse(
    anthropicFederationDesiredStateJson,
  );
  return {
    gemini: titlesByWorkload(google.google_workloads),
    anthropicFederation: titlesByWorkload(
      federation.anthropic_federation_workloads,
    ),
  };
}

export async function loadPlatformDesiredState(
  stackDir: string,
  expectedPlatform: PlatformStack,
): Promise<Record<string, unknown>> {
  const raw: unknown = await Bun.file(`${stackDir}/desired-state.json`).json();
  const actualPlatform = declaredPlatform(raw);
  if (actualPlatform !== expectedPlatform) {
    throw new Error(
      `Desired state for ${expectedPlatform} declares platform ${actualPlatform}`,
    );
  }

  switch (expectedPlatform) {
    case "openai":
      return variablesFromDesiredState(openAiDesiredState.parse(raw));
    case "anthropic":
      return variablesFromDesiredState(anthropicDesiredState.parse(raw));
    case "discord":
      return variablesFromDesiredState(discordDesiredState.parse(raw));
    case "anthropic-federation":
      return variablesFromDesiredState(
        anthropicFederationDesiredState.parse(raw),
      );
    case "google":
      return variablesFromDesiredState(googleDesiredState.parse(raw));
    case "cloudflare-tokens":
      return variablesFromDesiredState(cloudflareDesiredState.parse(raw));
  }
}
