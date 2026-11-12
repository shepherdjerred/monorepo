import type { Construct } from "constructs";
import {
  TerraformIterator,
  TerraformLocal,
  TerraformOutput,
  TerraformVariable,
  Token,
} from "cdktn";
import { ApiToken } from "#generated/providers/cloudflare/api-token/index.ts";
import { CloudflareProvider } from "#generated/providers/cloudflare/provider/index.ts";
import { encryptStateAndPlans } from "#src/encryption.ts";
import { HomelabStack } from "#src/homelab-stack.ts";
import { moved } from "#src/state-migrations.ts";

/**
 * The 1Password fields of an R2 S3 credential, by handoff unit suffix.
 * `packages/homelab/scripts/tofu/credential-handoff.ts` verifies the same
 * units against the vault, and its tests hold the two equal.
 */
const R2_S3_CREDENTIAL_FIELDS = {
  "s3-access-key-id": "CLOUDFLARE_R2_ACCESS_KEY_ID",
  "s3-secret-access-key": "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
} as const;

/**
 * Scoped Cloudflare API tokens, isolated from the DNS stack. The tokens come
 * from the stack's `desired-state.json`, which the stack runner injects as
 * `cloudflare_api_tokens`; see `packages/homelab/src/tofu/README.md`.
 *
 * HCL `for` expressions and `try` over an optional attribute have no cdktn
 * builder, so each is the expression itself, passed whole and never through
 * `Fn`, which would escape it.
 */
export class CloudflareTokensStack extends HomelabStack {
  constructor(scope: Construct) {
    super(scope, "cloudflare-tokens", {
      requiredVersion: ">= 1.11.0",
      providerConstraints: { cloudflare: "~> 5.27.0" },
    });
    encryptStateAndPlans(this, {
      description:
        "OpenTofu state and plan encryption passphrase from 1Password",
      errorMessage:
        "The OpenTofu state encryption passphrase must be at least 16 characters.",
    });

    // No default: a direct OpenTofu run must be given the token registry
    // rather than plan every managed token away.
    new TerraformVariable(this, "cloudflare_api_tokens", {
      description:
        "Scoped Cloudflare child tokens and their existing rotation units",
      type: "map(object({ managed = optional(bool, true), supersedes_id = optional(string), name = string, policies = list(object({ effect = string, permission_groups = list(object({ id = string, name = string })), resources = map(string) })), condition = optional(object({ request_ip = optional(object({ in = optional(list(string)), not_in = optional(list(string)) })) })), expires_on = optional(string), not_before = optional(string), status = optional(string), vault_item_id = string, vault_field = string, vault_json_path = optional(string), s3_credential = optional(bool, false) }))",
    });

    // Authenticated through the narrowly scoped CLOUDFLARE_API_TOKEN
    // bootstrap key.
    new CloudflareProvider(this, "cloudflare");

    // A deferred consumer (`managed = false`) creates no credential.
    const token = TerraformIterator.fromMap(
      Token.asAnyMap(
        "${{ for name, token in var.cloudflare_api_tokens : name => token if token.managed }}",
      ),
    );
    const managed = new ApiToken(this, "managed", {
      forEach: token,
      name: token.getString("name"),
      // `jsonencode` renders each policy's resource map inside OpenTofu, in
      // the order it always has.
      policies: Token.asAny(
        "${[for policy in each.value.policies : { effect = policy.effect, permission_groups = [for permission_group in policy.permission_groups : { id = permission_group.id }], resources = jsonencode(policy.resources) }]}",
      ),
      expiresOn: "${try(each.value.expires_on, null)}",
      notBefore: "${try(each.value.not_before, null)}",
      status: "${try(each.value.status, null)}",
    });
    // The binding types `condition` as a struct; the HCL passes the optional
    // object through.
    managed.addOverride("condition", "${try(each.value.condition, null)}");

    moved(
      this,
      'cloudflare_api_token.managed["buildkite"]',
      'cloudflare_api_token.managed["woodpecker"]',
    );

    // R2's S3 API authenticates with a credential derived from an API token:
    // the access key id is the token id and the secret access key is the
    // SHA-256 hex digest of the token value. A token that opts in hands both
    // off to fixed fields of its own 1Password item, as separate rotation
    // units. The field names are data, so they are not snake_cased.
    new TerraformLocal(
      this,
      "r2_s3_credential_fields",
      Token.asAny(R2_S3_CREDENTIAL_FIELDS),
    );
    new TerraformLocal(
      this,
      "r2_s3_credential_handoffs",
      '${merge([for name, token in cloudflare_api_token.managed : { for unit, field in local.r2_s3_credential_fields : "${name}.${unit}" => { value = unit == "s3-access-key-id" ? token.id : sha256(token.value), supersedes_id = null, vault_item_id = var.cloudflare_api_tokens[name].vault_item_id, vault_field = field, vault_json_path = null } } if var.cloudflare_api_tokens[name].s3_credential]...)}',
    );

    new TerraformOutput(this, "cloudflare_api_token_handoffs", {
      description:
        "Generated Cloudflare tokens and their existing 1Password rotation units",
      sensitive: true,
      value:
        "${merge({ for name, token in cloudflare_api_token.managed : name => { api_token = token.value, supersedes_id = var.cloudflare_api_tokens[name].supersedes_id, vault_item_id = var.cloudflare_api_tokens[name].vault_item_id, vault_field = var.cloudflare_api_tokens[name].vault_field, vault_json_path = try(var.cloudflare_api_tokens[name].vault_json_path, null) } }, local.r2_s3_credential_handoffs)}",
    });
  }
}
