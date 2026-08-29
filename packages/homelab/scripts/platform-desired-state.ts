import { z } from "zod";

export type PlatformStack =
  "openai" | "anthropic" | "discord" | "openrouter" | "cloudflare-tokens";

const SCHEMA_REFERENCE = "../platform-desired-state.schema.json";
const nonEmptyString = z.string().min(1);
const optionalNonEmptyString = nonEmptyString.optional();
const resourceMap = (schema: z.ZodType) => z.record(nonEmptyString, schema);
const schemaReference = z.literal(SCHEMA_REFERENCE);
const onePasswordTarget = z.strictObject({
  vault_item_id: nonEmptyString,
  vault_field: nonEmptyString,
  vault_json_path: optionalNonEmptyString,
});

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
  openai_project_spend_alerts: resourceMap(spendAlert),
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

const openRouterWorkspace = z.strictObject({
  workspace_id: optionalNonEmptyString,
  name: nonEmptyString,
  slug: nonEmptyString,
  description: optionalNonEmptyString,
  default_text_model: optionalNonEmptyString,
  default_image_model: optionalNonEmptyString,
  default_provider_sort: optionalNonEmptyString,
  io_logging_api_key_ids: z.array(z.number()).optional(),
  io_logging_sampling_rate: z.number().optional(),
  is_data_discount_logging_enabled: z.boolean().optional(),
  is_observability_broadcast_enabled: z.boolean().optional(),
  is_observability_io_logging_enabled: z.boolean().optional(),
});
const openRouterGuardrail = z.strictObject({
  guardrail_id: optionalNonEmptyString,
  name: nonEmptyString,
  workspace_key: optionalNonEmptyString,
  description: optionalNonEmptyString,
  limit_usd: z.number().optional(),
  reset_interval: optionalNonEmptyString,
  allowed_models: z.array(nonEmptyString).optional(),
  allowed_providers: z.array(nonEmptyString).optional(),
  ignored_models: z.array(nonEmptyString).optional(),
  ignored_providers: z.array(nonEmptyString).optional(),
  enforce_zdr_anthropic: z.boolean().optional(),
  enforce_zdr_google: z.boolean().optional(),
  enforce_zdr_openai: z.boolean().optional(),
  enforce_zdr_other: z.boolean().optional(),
});
const openRouterApiKey = z
  .strictObject({
    import_id: optionalNonEmptyString,
    name: nonEmptyString,
    workspace_key: optionalNonEmptyString,
    limit: z.number().optional(),
    limit_reset: optionalNonEmptyString,
    include_byok_in_limit: z.boolean().optional(),
    disabled: z.boolean().optional(),
    expires_at: optionalNonEmptyString,
    onepassword_targets: z.array(onePasswordTarget).optional(),
  })
  .superRefine((apiKey, context) => {
    if (
      apiKey.import_id === undefined &&
      (apiKey.onepassword_targets === undefined ||
        apiKey.onepassword_targets.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["onepassword_targets"],
        message: "a generated OpenRouter API key requires a 1Password target",
      });
    }
  });
const openRouterByokCredential = z.strictObject({
  byok_key_id: optionalNonEmptyString,
  provider_slug: nonEmptyString,
  name: optionalNonEmptyString,
  workspace_key: optionalNonEmptyString,
  allowed_models: z.array(nonEmptyString).optional(),
  allowed_user_ids: z.array(nonEmptyString).optional(),
  disabled: z.boolean().optional(),
  is_fallback: z.boolean().optional(),
  allowed_api_key_hashes: z.array(nonEmptyString).optional(),
});
const openRouterDesiredState = z.strictObject({
  $schema: schemaReference,
  platform: z.literal("openrouter"),
  openrouter_workspaces: resourceMap(openRouterWorkspace),
  openrouter_guardrails: resourceMap(openRouterGuardrail),
  openrouter_api_keys: resourceMap(openRouterApiKey),
  openrouter_byok_credentials: resourceMap(openRouterByokCredential),
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
    .enum(["openai", "anthropic", "discord", "openrouter", "cloudflare-tokens"])
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
    case "openrouter":
      return variablesFromDesiredState(openRouterDesiredState.parse(raw));
    case "cloudflare-tokens":
      return variablesFromDesiredState(cloudflareDesiredState.parse(raw));
  }
}
