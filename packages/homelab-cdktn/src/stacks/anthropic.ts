import type { Construct } from "constructs";
import {
  TerraformIterator,
  TerraformOutput,
  TerraformVariable,
  Token,
} from "cdktn";
import { AnthropicProvider } from "#generated/providers/anthropic/provider/index.ts";
import { ApiKey } from "#generated/providers/anthropic/api-key/index.ts";
import { Workspace } from "#generated/providers/anthropic/workspace/index.ts";
import { WorkspaceMember } from "#generated/providers/anthropic/workspace-member/index.ts";
import { HomelabStack } from "#src/homelab-stack.ts";
import { encryptState } from "#src/state-encryption.ts";
import { retire } from "#src/state-migrations.ts";

/**
 * Anthropic workspaces, members and imported API-key metadata. Reviewed-plan:
 * Delivery plans it after merge and an operator approves the plan. The
 * values come from the stack's `desired-state.json`, which the stack runner
 * injects as variables.
 */
export class AnthropicStack extends HomelabStack {
  constructor(scope: Construct) {
    super(scope, "anthropic", {
      requiredVersion: ">= 1.9.0",
      providerConstraints: { anthropic: "1.60.0" },
    });
    encryptState(this);

    const workspaces = new TerraformVariable(this, "anthropic_workspaces", {
      description: "Anthropic workspaces to create and manage",
      type: "map(object({ name = string, workspace_id = optional(string) }))",
      default: {},
    });

    const apiKeys = new TerraformVariable(this, "anthropic_api_keys", {
      description: "Anthropic organization or workspace API keys",
      type: "map(object({ api_key_id = string, name = string, status = string, vault_item_id = optional(string), vault_field = optional(string), vault_json_path = optional(string) }))",
      default: {},
    });
    // HCL `for` expressions have no cdktn builder, so the condition is the
    // expression itself. It is passed whole, never through `Fn`, which would
    // escape it.
    apiKeys.addValidation({
      condition:
        '${alltrue([for key in values(var.anthropic_api_keys) : contains(["active", "inactive", "archived"], key.status) && (key.status == "archived" ? key.vault_item_id == null && key.vault_field == null && key.vault_json_path == null : try(length(key.vault_item_id), 0) > 0 && try(length(key.vault_field), 0) > 0)])}',
      errorMessage:
        "Active and inactive keys require a vault rotation target; archived keys must retain only nonsecret metadata.",
    });

    const workspaceMembers = new TerraformVariable(
      this,
      "anthropic_workspace_members",
      {
        description: "Anthropic workspace membership and roles",
        type: "map(object({ workspace_key = string, user_id = string, workspace_role = string }))",
        default: {},
      },
    );

    // Authenticated through ANTHROPIC_ADMIN_API_KEY.
    new AnthropicProvider(this, "anthropic");

    // Three resource types share the HCL name `managed`, but construct ids
    // are unique per scope, so each takes a distinct id and keeps its
    // address through `overrideLogicalId`.
    const workspace = TerraformIterator.fromMap(
      Token.asAnyMap(workspaces.value),
    );
    new Workspace(this, "workspace_managed", {
      forEach: workspace,
      name: workspace.getString("name"),
    }).overrideLogicalId("managed");

    const apiKey = TerraformIterator.fromMap(Token.asAnyMap(apiKeys.value));
    new ApiKey(this, "api_key_managed", {
      forEach: apiKey,
      name: apiKey.getString("name"),
      status: apiKey.getString("status"),
      lifecycle: { preventDestroy: true },
    }).overrideLogicalId("managed");

    const member = TerraformIterator.fromMap(
      Token.asAnyMap(workspaceMembers.value),
    );
    new WorkspaceMember(this, "workspace_member_managed", {
      forEach: member,
      workspaceId:
        "${anthropic_workspace.managed[each.value.workspace_key].id}",
      userId: member.getString("user_id"),
      workspaceRole: member.getString("workspace_role"),
    }).overrideLogicalId("managed");

    // `import` blocks with `for_each` have no cdktn builder
    // (`importFrom` takes one literal id), so they are a stack override.
    this.addOverride("import", [
      {
        for_each:
          "${{ for name, workspace in var.anthropic_workspaces : name => workspace if try(workspace.workspace_id, null) != null }}",
        to: "anthropic_workspace.managed[each.key]",
        id: "${each.value.workspace_id}",
      },
      {
        for_each: "${var.anthropic_api_keys}",
        to: "anthropic_api_key.managed[each.key]",
        id: "${each.value.api_key_id}",
      },
    ]);

    new TerraformOutput(this, "anthropic_workspace_ids", {
      description: "Anthropic workspace IDs",
      value:
        "${{ for name, workspace in anthropic_workspace.managed : name => workspace.id }}",
    });

    new TerraformOutput(this, "anthropic_api_key_rotation_units", {
      description:
        "Imported Anthropic API key IDs and their existing 1Password rotation units",
      value:
        '${{ for name, key in anthropic_api_key.managed : name => { api_key_id = key.id, vault_item_id = var.anthropic_api_keys[name].vault_item_id, vault_field = var.anthropic_api_keys[name].vault_field, vault_json_path = try(var.anthropic_api_keys[name].vault_json_path, null) } if var.anthropic_api_keys[name].status != "archived" }}',
    });

    // The archived OpenRouter key no longer needs managed metadata. Archiving
    // is already terminal in Anthropic, and the resource has
    // `prevent_destroy`, so OpenTofu forgets the key instead of destroying it.
    retire(this, {
      from: 'anthropic_api_key.managed["openrouter"]',
      as: "anthropic_api_key.retired_openrouter",
    });
  }
}
