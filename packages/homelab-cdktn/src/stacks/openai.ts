import type { Construct } from "constructs";
import {
  TerraformIterator,
  TerraformOutput,
  TerraformVariable,
  Token,
  ref,
} from "cdktn";
import { Certificate } from "#generated/providers/openai/certificate/index.ts";
import { Group } from "#generated/providers/openai/group/index.ts";
import { GroupRole } from "#generated/providers/openai/group-role/index.ts";
import { GroupUser } from "#generated/providers/openai/group-user/index.ts";
import { OrganizationSpendAlert } from "#generated/providers/openai/organization-spend-alert/index.ts";
import { OrganizationSpendLimit } from "#generated/providers/openai/organization-spend-limit/index.ts";
import { OrganizationUser } from "#generated/providers/openai/organization-user/index.ts";
import { Project } from "#generated/providers/openai/project/index.ts";
import { ProjectDataRetention } from "#generated/providers/openai/project-data-retention/index.ts";
import { ProjectGroup } from "#generated/providers/openai/project-group/index.ts";
import { ProjectGroupRole } from "#generated/providers/openai/project-group-role/index.ts";
import { ProjectHostedToolPermissions } from "#generated/providers/openai/project-hosted-tool-permissions/index.ts";
import { ProjectModelPermissions } from "#generated/providers/openai/project-model-permissions/index.ts";
import { ProjectRateLimit } from "#generated/providers/openai/project-rate-limit/index.ts";
import { ProjectSpendAlert } from "#generated/providers/openai/project-spend-alert/index.ts";
import { ProjectSpendLimit } from "#generated/providers/openai/project-spend-limit/index.ts";
import { ProjectUserRole } from "#generated/providers/openai/project-user-role/index.ts";
import { OpenaiProvider } from "#generated/providers/openai/provider/index.ts";
import { Role } from "#generated/providers/openai/role/index.ts";
import { UserRole } from "#generated/providers/openai/user-role/index.ts";
import { ProjectServiceAccount } from "#generated/providers/openaikeys/project-service-account/index.ts";
import { OpenaikeysProvider } from "#generated/providers/openaikeys/provider/index.ts";
import { HomelabStack } from "#src/homelab-stack.ts";
import { encryptStateAndPlans } from "#src/encryption.ts";
import { moved, retire } from "#src/state-migrations.ts";

/** `try(each.value.<attribute>, null)`: an attribute the desired state may omit. */
function optional(attribute: string) {
  return ref(`try(each.value.${attribute}, null)`);
}

const PROJECT_ID = "${openai_project.managed[each.value.project_key].id}";
const GROUP_ID = "${openai_group.managed[each.value.group_key].id}";

/**
 * OpenAI projects, organization users, groups, roles, spend controls and
 * project service accounts. Reviewed-plan: Delivery plans it after merge and
 * an operator approves the plan. The values come from the stack's
 * `desired-state.json`, which the stack runner injects as variables.
 *
 * Two providers serve resource types that start with `openai_`. The official
 * `openai/openai` provider is the default for that prefix and manages every
 * organization control. The `jianyuan/openai` companion, under the local name
 * `openaikeys`, is selected explicitly and only for project service accounts,
 * whose generated API key it returns.
 */
export class OpenaiStack extends HomelabStack {
  constructor(scope: Construct) {
    super(scope, "openai", {
      requiredVersion: ">= 1.9.0",
      providerConstraints: { openai: "~> 1.1", openaikeys: "~> 0.7" },
    });

    const map = (id: string, description: string, type: string) =>
      new TerraformVariable(this, id, {
        description,
        type: `map(object({ ${type} }))`,
        default: {},
      });
    const each = (variable: TerraformVariable) =>
      TerraformIterator.fromMap(Token.asAnyMap(variable.value));

    const projects = map(
      "openai_projects",
      "OpenAI projects to create and manage",
      "project_id = optional(string), name = string, geography = optional(string), external_key_id = optional(string)",
    );
    const serviceAccounts = map(
      "openai_service_accounts",
      "OpenAI project service accounts whose generated keys are handed to 1Password",
      "project_key = string, name = string, onepassword_targets = list(object({ vault_item_id = string, vault_field = string, vault_json_path = optional(string) }))",
    );
    const organizationUsers = map(
      "openai_organization_users",
      "Existing OpenAI organization users to manage after importing them",
      "user_id = string, role = optional(string), developer_persona = optional(string), technical_level = optional(string)",
    );
    const projectUsers = map(
      "openai_project_users",
      "OpenAI project user memberships and roles",
      "project_key = string, user_id = string, role_id = string",
    );
    const projectSpendAlerts = map(
      "openai_project_spend_alerts",
      "OpenAI project spend alerts",
      "project_key = string, threshold_amount = number, currency = string, interval = string, notification_channel_type = string, notification_channel_recipients = list(string), notification_channel_subject_prefix = optional(string)",
    );
    const groups = map(
      "openai_groups",
      "Existing OpenAI organization groups to import and manage",
      "group_id = string, name = string",
    );
    const groupUsers = map(
      "openai_group_users",
      "OpenAI organization group memberships",
      "group_key = string, user_id = string",
    );
    const groupRoles = map(
      "openai_group_roles",
      "OpenAI organization group role assignments",
      "group_key = string, role_id = string",
    );
    const userRoles = map(
      "openai_user_roles",
      "OpenAI organization user role assignments",
      "user_id = string, role_id = string",
    );
    const roles = map(
      "openai_roles",
      "Custom OpenAI organization roles",
      "role_name = string, permissions = list(string), description = optional(string)",
    );
    const certificates = map(
      "openai_certificates",
      "OpenAI certificate metadata",
      "certificate_id = string, name = optional(string)",
    );
    const certificateValues = new TerraformVariable(
      this,
      "openai_certificate_values",
      {
        description:
          "OpenAI certificate PEM values keyed by certificate metadata",
        type: "map(string)",
        default: {},
        sensitive: true,
      },
    );
    // Metadata and PEM values arrive as separate JSON env vars, so they can
    // drift. Every certificate indexes this map, and without this check a
    // metadata entry with no PEM fails as an opaque invalid-index error. The
    // message is static: the missing names derive from a sensitive map, and
    // OpenTofu rejects an error message built from sensitive values.
    certificateValues.addValidation({
      condition:
        "${length(setsubtract(toset(keys(var.openai_certificates)), toset(keys(var.openai_certificate_values)))) == 0}",
      errorMessage:
        "Every openai_certificates entry needs a matching openai_certificate_values entry.",
    });
    const organizationSpendAlerts = map(
      "openai_organization_spend_alerts",
      "OpenAI organization spend alerts",
      "threshold_amount = number, currency = string, interval = string, notification_channel_type = string, notification_channel_recipients = list(string), notification_channel_subject_prefix = optional(string)",
    );
    const organizationSpendLimits = map(
      "openai_organization_spend_limits",
      "OpenAI organization hard spend limits",
      "threshold_amount = number, currency = string, interval = string",
    );
    const projectGroups = map(
      "openai_project_groups",
      "OpenAI project group assignments",
      "project_key = string, group_key = string, role = string",
    );
    const projectGroupRoles = map(
      "openai_project_group_roles",
      "OpenAI project group role assignments",
      "project_key = string, group_key = string, role_id = string",
    );
    const projectDataRetention = map(
      "openai_project_data_retention",
      "OpenAI project data retention controls",
      "project_key = string, type = string",
    );
    const projectModelPermissions = map(
      "openai_project_model_permissions",
      "OpenAI project model allow/deny lists",
      "project_key = string, mode = string, model_ids = list(string)",
    );
    const projectHostedToolPermissions = map(
      "openai_project_hosted_tool_permissions",
      "OpenAI project hosted tool controls",
      "project_key = string, file_search_enabled = bool, web_search_enabled = bool, image_generation_enabled = bool, mcp_enabled = bool, code_interpreter_enabled = bool",
    );
    const projectSpendLimits = map(
      "openai_project_spend_limits",
      "OpenAI project hard spend limits",
      "project_key = string, threshold_amount = number, currency = string, interval = string",
    );
    const projectRateLimits = map(
      "openai_project_rate_limits",
      "OpenAI existing project rate limits",
      "project_key = string, rate_limit_id = string, batch_1_day_max_input_tokens = optional(number), max_audio_megabytes_per_1_minute = optional(number), max_images_per_1_minute = optional(number), max_requests_per_1_day = optional(number), max_requests_per_1_minute = optional(number), max_tokens_per_1_minute = optional(number)",
    );

    encryptStateAndPlans(this, {
      description:
        "OpenTofu state and plan encryption passphrase from 1Password",
      errorMessage:
        "The OpenTofu state encryption passphrase must be at least 16 characters.",
    });

    // The official provider reads its standard API-key variable; the stack
    // manifest maps that name from the dedicated OPENAI_ADMIN_KEY 1Password
    // field (see packages/homelab/scripts/tofu/tofu-stack-manifest.ts).
    new OpenaiProvider(this, "openai");
    // The companion provider reads the same variable and is used only for
    // the service-account API key returned by its service-account resource;
    // organization controls remain on the official provider above.
    const keys = new OpenaikeysProvider(this, "openaikeys");

    // Most resource types share the HCL name `managed`, but construct ids are
    // unique per scope, so each takes a distinct id and keeps its address
    // through `overrideLogicalId`.
    const project = each(projects);
    new Project(this, "project_managed", {
      forEach: project,
      name: project.getString("name"),
      geography: Token.asString(optional("geography")),
      externalKeyId: Token.asString(optional("external_key_id")),
    }).overrideLogicalId("managed");

    const organizationUser = each(organizationUsers);
    new OrganizationUser(this, "organization_user_managed", {
      forEach: organizationUser,
      role: Token.asString(optional("role")),
      developerPersona: Token.asString(optional("developer_persona")),
      technicalLevel: Token.asString(optional("technical_level")),
      lifecycle: { preventDestroy: true },
    }).overrideLogicalId("managed");

    const group = each(groups);
    new Group(this, "group_managed", {
      forEach: group,
      name: group.getString("name"),
      lifecycle: { preventDestroy: true },
    }).overrideLogicalId("managed");

    const groupUser = each(groupUsers);
    new GroupUser(this, "group_user_managed", {
      forEach: groupUser,
      groupId: GROUP_ID,
      userId: groupUser.getString("user_id"),
    }).overrideLogicalId("managed");

    const groupRole = each(groupRoles);
    new GroupRole(this, "group_role_managed", {
      forEach: groupRole,
      groupId: GROUP_ID,
      roleId: groupRole.getString("role_id"),
    }).overrideLogicalId("managed");

    const userRole = each(userRoles);
    new UserRole(this, "user_role_managed", {
      forEach: userRole,
      userId: userRole.getString("user_id"),
      roleId: userRole.getString("role_id"),
    }).overrideLogicalId("managed");

    const role = each(roles);
    new Role(this, "role_managed", {
      forEach: role,
      roleName: role.getString("role_name"),
      permissions: role.getList("permissions"),
      description: Token.asString(optional("description")),
    }).overrideLogicalId("managed");

    const certificate = each(certificates);
    new Certificate(this, "certificate_managed", {
      forEach: certificate,
      certificate: "${var.openai_certificate_values[each.key]}",
      name: Token.asString(optional("name")),
    }).overrideLogicalId("managed");

    const organizationSpendAlert = each(organizationSpendAlerts);
    new OrganizationSpendAlert(this, "organization_spend_alert_managed", {
      forEach: organizationSpendAlert,
      thresholdAmount: organizationSpendAlert.getNumber("threshold_amount"),
      currency: organizationSpendAlert.getString("currency"),
      interval: organizationSpendAlert.getString("interval"),
      notificationChannelType: organizationSpendAlert.getString(
        "notification_channel_type",
      ),
      notificationChannelRecipients: organizationSpendAlert.getList(
        "notification_channel_recipients",
      ),
      notificationChannelSubjectPrefix: Token.asString(
        optional("notification_channel_subject_prefix"),
      ),
    }).overrideLogicalId("managed");

    const organizationSpendLimit = each(organizationSpendLimits);
    new OrganizationSpendLimit(this, "organization_spend_limit_managed", {
      forEach: organizationSpendLimit,
      thresholdAmount: organizationSpendLimit.getNumber("threshold_amount"),
      currency: organizationSpendLimit.getString("currency"),
      interval: organizationSpendLimit.getString("interval"),
    }).overrideLogicalId("managed");

    const projectUser = each(projectUsers);
    new ProjectUserRole(this, "project_user_role_managed", {
      forEach: projectUser,
      projectId: PROJECT_ID,
      userId: projectUser.getString("user_id"),
      roleId: projectUser.getString("role_id"),
    }).overrideLogicalId("managed");

    const projectSpendAlert = each(projectSpendAlerts);
    const projectSpendAlertResource = new ProjectSpendAlert(
      this,
      "project_spend_alert_managed",
      {
        forEach: projectSpendAlert,
        projectId: PROJECT_ID,
        thresholdAmount: projectSpendAlert.getNumber("threshold_amount"),
        currency: projectSpendAlert.getString("currency"),
        interval: projectSpendAlert.getString("interval"),
        notificationChannelType: projectSpendAlert.getString(
          "notification_channel_type",
        ),
        notificationChannelRecipients: projectSpendAlert.getList(
          "notification_channel_recipients",
        ),
        notificationChannelSubjectPrefix: Token.asString(
          optional("notification_channel_subject_prefix"),
        ),
      },
    );
    projectSpendAlertResource.overrideLogicalId("managed");

    const projectGroup = each(projectGroups);
    new ProjectGroup(this, "project_group_managed", {
      forEach: projectGroup,
      projectId: PROJECT_ID,
      groupId: GROUP_ID,
      role: projectGroup.getString("role"),
    }).overrideLogicalId("managed");

    const projectGroupRole = each(projectGroupRoles);
    new ProjectGroupRole(this, "project_group_role_managed", {
      forEach: projectGroupRole,
      projectId: PROJECT_ID,
      groupId: GROUP_ID,
      roleId: projectGroupRole.getString("role_id"),
    }).overrideLogicalId("managed");

    const dataRetention = each(projectDataRetention);
    new ProjectDataRetention(this, "project_data_retention_managed", {
      forEach: dataRetention,
      projectId: PROJECT_ID,
      type: dataRetention.getString("type"),
    }).overrideLogicalId("managed");

    const modelPermissions = each(projectModelPermissions);
    new ProjectModelPermissions(this, "project_model_permissions_managed", {
      forEach: modelPermissions,
      projectId: PROJECT_ID,
      mode: modelPermissions.getString("mode"),
      modelIds: modelPermissions.getList("model_ids"),
    }).overrideLogicalId("managed");

    const hostedTools = each(projectHostedToolPermissions);
    new ProjectHostedToolPermissions(
      this,
      "project_hosted_tool_permissions_managed",
      {
        forEach: hostedTools,
        projectId: PROJECT_ID,
        fileSearchEnabled: hostedTools.getBoolean("file_search_enabled"),
        webSearchEnabled: hostedTools.getBoolean("web_search_enabled"),
        imageGenerationEnabled: hostedTools.getBoolean(
          "image_generation_enabled",
        ),
        mcpEnabled: hostedTools.getBoolean("mcp_enabled"),
        codeInterpreterEnabled: hostedTools.getBoolean(
          "code_interpreter_enabled",
        ),
      },
    ).overrideLogicalId("managed");

    const projectSpendLimit = each(projectSpendLimits);
    new ProjectSpendLimit(this, "project_spend_limit_managed", {
      forEach: projectSpendLimit,
      // OpenAI rejects hard-limit writes while spend alerts are being updated.
      dependsOn: [projectSpendAlertResource],
      projectId: PROJECT_ID,
      thresholdAmount: projectSpendLimit.getNumber("threshold_amount"),
      currency: projectSpendLimit.getString("currency"),
      interval: projectSpendLimit.getString("interval"),
    }).overrideLogicalId("managed");

    const rateLimit = each(projectRateLimits);
    new ProjectRateLimit(this, "project_rate_limit_managed", {
      forEach: rateLimit,
      projectId: PROJECT_ID,
      rateLimitId: rateLimit.getString("rate_limit_id"),
      batch1DayMaxInputTokens: Token.asNumber(
        optional("batch_1_day_max_input_tokens"),
      ),
      maxAudioMegabytesPer1Minute: Token.asNumber(
        optional("max_audio_megabytes_per_1_minute"),
      ),
      maxImagesPer1Minute: Token.asNumber(optional("max_images_per_1_minute")),
      maxRequestsPer1Day: Token.asNumber(optional("max_requests_per_1_day")),
      maxRequestsPer1Minute: Token.asNumber(
        optional("max_requests_per_1_minute"),
      ),
      maxTokensPer1Minute: Token.asNumber(optional("max_tokens_per_1_minute")),
    }).overrideLogicalId("managed");

    // The one resource of the companion provider. Its type also starts with
    // `openai_`, so without the explicit provider OpenTofu would hand it to
    // the official one.
    const serviceAccount = each(serviceAccounts);
    new ProjectServiceAccount(this, "service_accounts", {
      forEach: serviceAccount,
      provider: keys,
      projectId: PROJECT_ID,
      name: serviceAccount.getString("name"),
    });

    // `import` blocks with `for_each` have no cdktn builder (`importFrom`
    // takes one literal id), so they are a stack override.
    this.addOverride("import", [
      {
        for_each:
          "${{ for name, project in var.openai_projects : name => project if try(project.project_id, null) != null }}",
        to: "openai_project.managed[each.key]",
        id: "${each.value.project_id}",
      },
      {
        for_each: "${var.openai_groups}",
        to: "openai_group.managed[each.key]",
        id: "${each.value.group_id}",
      },
      {
        for_each: "${var.openai_certificates}",
        to: "openai_certificate.managed[each.key]",
        id: "${each.value.certificate_id}",
      },
      {
        for_each: "${var.openai_organization_users}",
        to: "openai_organization_user.managed[each.key]",
        id: "${each.value.user_id}",
      },
    ]);

    new TerraformOutput(this, "openai_project_ids", {
      description: "OpenAI project IDs",
      value:
        "${{ for name, project in openai_project.managed : name => project.id }}",
    });

    new TerraformOutput(this, "openai_service_account_handoffs", {
      description:
        "Generated service-account keys and their existing 1Password rotation units",
      sensitive: true,
      value:
        "${{ for name, account in openai_project_service_account.service_accounts : name => { api_key = account.api_key, onepassword_targets = var.openai_service_accounts[name].onepassword_targets } }}",
    });

    this.migrateState();
  }

  /** The `moved` and `removed` blocks state still needs. */
  private migrateState(): void {
    // The Buildkite project became the Woodpecker project.
    moved(
      this,
      'openai_project.managed["buildkite"]',
      'openai_project.managed["woodpecker"]',
    );
    moved(
      this,
      'openai_project_spend_alert.managed["buildkite-monthly"]',
      'openai_project_spend_alert.managed["woodpecker-monthly"]',
    );
    moved(
      this,
      'openai_project_spend_limit.managed["buildkite-monthly"]',
      'openai_project_spend_limit.managed["woodpecker-monthly"]',
    );
    moved(
      this,
      'openai_project_model_permissions.managed["buildkite"]',
      'openai_project_model_permissions.managed["woodpecker"]',
    );

    // OpenRouter is retired; inference calls providers directly. Its project
    // was archived in the OpenAI dashboard, which is the terminal state a
    // destroy would reach, so OpenTofu forgets the project instead of
    // archiving it again.
    //
    // Its BYOK service account left state through `tofu state rm` instead:
    // OpenAI rejects every read of a service account in an archived project,
    // and OpenTofu refreshes even resources it is only forgetting.
    retire(this, {
      from: 'openai_project.managed["openrouter"]',
      as: "openai_project.retired_openrouter",
    });

    // The Scout beta, Scout voice, and Scout prod projects were archived in
    // the OpenAI dashboard, which cannot be undone. Their project ids are
    // listed under "OpenAI" in `packages/homelab/src/tofu/README.md`. Each workload moves to a new project with the same allowlist, spend
    // limit, and alert, and a newly dated service account writes the same
    // 1Password field. OpenTofu forgets the archived projects and their spend
    // controls instead of planning a destroy against them. A moved object's
    // old key cannot stay declared, hence the new keys.
    //
    // Their service accounts and model allowlists left state through
    // `tofu state rm` instead, as with OpenRouter: OpenAI rejects every read
    // of either in an archived project. Archived projects and their spend
    // alerts and limits stay readable.
    retire(this, {
      from: 'openai_project.managed["scout-beta"]',
      as: "openai_project.retired_scout_beta",
    });
    retire(this, {
      from: 'openai_project_spend_alert.managed["scout-beta-monthly"]',
      as: "openai_project_spend_alert.retired_scout_beta_monthly",
    });
    retire(this, {
      from: 'openai_project_spend_limit.managed["scout-beta-monthly"]',
      as: "openai_project_spend_limit.retired_scout_beta_monthly",
    });
    retire(this, {
      from: 'openai_project.managed["scout-active-2026-09"]',
      as: "openai_project.retired_scout_active_2026_09",
    });
    retire(this, {
      from: 'openai_project_spend_alert.managed["scout-monthly"]',
      as: "openai_project_spend_alert.retired_scout_monthly",
    });
    retire(this, {
      from: 'openai_project_spend_limit.managed["scout-active-monthly-2026-09"]',
      as: "openai_project_spend_limit.retired_scout_active_monthly_2026_09",
    });
    retire(this, {
      from: 'openai_project.managed["scout-prod-active-2026-09"]',
      as: "openai_project.retired_scout_prod_active_2026_09",
    });
    retire(this, {
      from: 'openai_project_spend_alert.managed["scout-prod-monthly"]',
      as: "openai_project_spend_alert.retired_scout_prod_monthly",
    });
    retire(this, {
      from: 'openai_project_spend_limit.managed["scout-prod-monthly"]',
      as: "openai_project_spend_limit.retired_scout_prod_monthly",
    });
  }
}
