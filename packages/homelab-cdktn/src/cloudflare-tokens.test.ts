import path from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { synthesize } from "#scripts/synth.ts";

const MANAGED = "cloudflare_api_token.managed";

const ConfigurationSchema = z.looseObject({
  terraform: z.looseObject({
    encryption: z.unknown(),
    required_version: z.string(),
    required_providers: z.record(
      z.string(),
      z.object({ source: z.string(), version: z.string() }),
    ),
  }),
  variable: z.record(z.string(), z.record(z.string(), z.unknown())),
  locals: z.record(z.string(), z.unknown()),
  resource: z.record(z.string(), z.record(z.string(), z.unknown())),
  import: z.unknown().optional(),
  moved: z.array(z.record(z.string(), z.unknown())),
  removed: z.unknown().optional(),
  output: z.record(z.string(), z.record(z.string(), z.unknown())),
});

const TokenSchema = z.looseObject({
  managed: z.boolean().default(true),
  policies: z.array(
    z.object({
      effect: z.string(),
      permission_groups: z.array(
        z.object({ id: z.string(), name: z.string() }),
      ),
      resources: z.record(z.string(), z.string()),
    }),
  ),
  expires_on: z.string().optional(),
  status: z.string().optional(),
  vault_item_id: z.string(),
  vault_field: z.string(),
  s3_credential: z.boolean().default(false),
});

const DesiredStateSchema = z.looseObject({
  cloudflare_api_tokens: z.record(z.string(), TokenSchema),
});

async function cloudflareTokens() {
  const synthesized = await synthesize();
  return ConfigurationSchema.parse(
    JSON.parse(synthesized.get("cloudflare-tokens") ?? ""),
  );
}

/** The committed registry the stack runner injects as `cloudflare_api_tokens`. */
async function committedTokens() {
  const desired: unknown = await Bun.file(
    path.resolve(
      import.meta.dir,
      "../../homelab/src/tofu/cloudflare-tokens/desired-state.json",
    ),
  ).json();
  return DesiredStateSchema.parse(desired).cloudflare_api_tokens;
}

describe("cloudflare-tokens", () => {
  test("keeps the one token address, its rename and its encrypted state", async () => {
    const {
      resource,
      moved,
      removed,
      import: imports,
      terraform,
      variable,
    } = await cloudflareTokens();
    expect(
      Object.entries(resource).flatMap(([type, byName]) =>
        Object.keys(byName).map((name) => `${type}.${name}`),
      ),
    ).toEqual([MANAGED]);
    expect(moved).toEqual([
      { from: `${MANAGED}["buildkite"]`, to: `${MANAGED}["woodpecker"]` },
    ]);
    expect(removed).toBeUndefined();
    expect(imports).toBeUndefined();
    expect(terraform.required_version).toBe(">= 1.11.0");
    // The lock file records this constraint; a different one rewrites it.
    expect(terraform.required_providers).toEqual({
      cloudflare: { source: "cloudflare/cloudflare", version: "~> 5.27.0" },
    });
    // Encrypted state records the key provider's address.
    expect(terraform.encryption).toMatchObject({
      key_provider: {
        pbkdf2: {
          state: { passphrase: "${var.tofu_state_encryption_passphrase}" },
        },
      },
      state: { method: "method.aes_gcm.encrypted", enforced: true },
      plan: { method: "method.aes_gcm.encrypted", enforced: true },
    });
    expect(Object.keys(variable).toSorted()).toEqual([
      "cloudflare_api_tokens",
      "tofu_state_encryption_passphrase",
    ]);
    // A direct OpenTofu run must be given the registry: a default of `{}`
    // would plan every managed token away.
    expect(variable["cloudflare_api_tokens"]).not.toHaveProperty("default");
  });

  test("a deferred consumer neither creates a credential nor publishes a handoff", async () => {
    const { resource, output, locals } = await cloudflareTokens();
    const managed = resource["cloudflare_api_token"]?.["managed"];
    // Only `managed` entries become instances, under their registry keys...
    expect(managed).toMatchObject({
      for_each:
        "${{ for name, token in var.cloudflare_api_tokens : name => token if token.managed }}",
      name: "${each.value.name}",
    });
    // ...and every handoff unit is derived from those instances, never from
    // the registry, so an unmanaged entry can publish nothing.
    const handoffs = output["cloudflare_api_token_handoffs"];
    expect(Object.keys(output)).toEqual(["cloudflare_api_token_handoffs"]);
    expect(handoffs).toEqual({
      description:
        "Generated Cloudflare tokens and their existing 1Password rotation units",
      sensitive: true,
      value:
        "${merge({ for name, token in cloudflare_api_token.managed : name => { api_token = token.value, supersedes_id = var.cloudflare_api_tokens[name].supersedes_id, vault_item_id = var.cloudflare_api_tokens[name].vault_item_id, vault_field = var.cloudflare_api_tokens[name].vault_field, vault_json_path = try(var.cloudflare_api_tokens[name].vault_json_path, null) } }, local.r2_s3_credential_handoffs)}",
    });
    for (const expression of [
      handoffs?.["value"],
      locals["r2_s3_credential_handoffs"],
    ]) {
      expect(expression).toContain(`for name, token in ${MANAGED} :`);
      expect(expression).not.toContain("in var.cloudflare_api_tokens");
    }
  });

  test("a token carries exactly its declared policies, condition, validity and status", async () => {
    const { resource, variable } = await cloudflareTokens();
    // Permission groups are reduced to their ids, and each resource map is
    // encoded inside OpenTofu so its rendering never depends on synthesis.
    expect(resource["cloudflare_api_token"]?.["managed"]).toEqual({
      for_each:
        "${{ for name, token in var.cloudflare_api_tokens : name => token if token.managed }}",
      name: "${each.value.name}",
      policies:
        "${[for policy in each.value.policies : { effect = policy.effect, permission_groups = [for permission_group in policy.permission_groups : { id = permission_group.id }], resources = jsonencode(policy.resources) }]}",
      condition: "${try(each.value.condition, null)}",
      expires_on: "${try(each.value.expires_on, null)}",
      not_before: "${try(each.value.not_before, null)}",
      status: "${try(each.value.status, null)}",
    });
    expect(variable["cloudflare_api_tokens"]).toEqual({
      description:
        "Scoped Cloudflare child tokens and their existing rotation units",
      type: "map(object({ managed = optional(bool, true), supersedes_id = optional(string), name = string, policies = list(object({ effect = string, permission_groups = list(object({ id = string, name = string })), resources = map(string) })), condition = optional(object({ request_ip = optional(object({ in = optional(list(string)), not_in = optional(list(string)) })) })), expires_on = optional(string), not_before = optional(string), status = optional(string), vault_item_id = string, vault_field = string, vault_json_path = optional(string), s3_credential = optional(bool, false) }))",
    });
  });

  test("a token with s3_credential hands off the derived R2 keys to its own item", async () => {
    const { locals } = await cloudflareTokens();
    expect(Object.keys(locals)).toEqual([
      "r2_s3_credential_fields",
      "r2_s3_credential_handoffs",
    ]);
    // Unit suffixes and 1Password field names are data, not snake_cased keys.
    expect(locals["r2_s3_credential_fields"]).toEqual({
      "s3-access-key-id": "CLOUDFLARE_R2_ACCESS_KEY_ID",
      "s3-secret-access-key": "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
    });
    // One `<token>.<unit>` handoff per field, only for a token that opts in:
    // the access key id is the token id, the secret its SHA-256 digest.
    expect(locals["r2_s3_credential_handoffs"]).toBe(
      '${merge([for name, token in cloudflare_api_token.managed : { for unit, field in local.r2_s3_credential_fields : "${name}.${unit}" => { value = unit == "s3-access-key-id" ? token.id : sha256(token.value), supersedes_id = null, vault_item_id = var.cloudflare_api_tokens[name].vault_item_id, vault_field = field, vault_json_path = null } } if var.cloudflare_api_tokens[name].s3_credential]...)}',
    );
  });
});

// The purge token's exact policy, expiry and handoff are held by
// packages/homelab/scripts/tofu/tofu-stack.test.ts, and the handoff units the
// registry publishes by credential-handoff.test.ts there.
describe("committed Cloudflare token registry", () => {
  test("manages exactly the cache, archive and Woodpecker tokens", async () => {
    const tokens = await committedTokens();
    expect(
      Object.entries(tokens)
        .filter(([, token]) => token.managed)
        .map(([name]) => name)
        .toSorted(),
    ).toEqual(["delivery-static-cache", "personal-archives-r2", "woodpecker"]);
    expect(
      Object.entries(tokens)
        .filter(([, token]) => token.managed && token.s3_credential)
        .map(([name]) => name),
    ).toEqual(["personal-archives-r2"]);
  });

  test("the archive token grants only object read and write on the two archive buckets", async () => {
    const tokens = await committedTokens();
    const token = tokens["personal-archives-r2"];
    expect(token?.policies).toHaveLength(1);
    const [policy] = token?.policies ?? [];
    expect(policy?.effect).toBe("allow");
    expect(policy?.permission_groups.map(({ id }) => id).toSorted()).toEqual([
      "2efd5506f9c8494dacb1fa10a3e7d5b6",
      "6a018a9f2fc74eb6b293b0c548f38b39",
    ]);
    expect(policy?.resources).toEqual({
      "com.cloudflare.edge.r2.bucket.48948ed6cd40d73e34d27f0cc10e595f_default_jerred-archives":
        "*",
      "com.cloudflare.edge.r2.bucket.48948ed6cd40d73e34d27f0cc10e595f_default_pinterest-archives":
        "*",
    });
    // Its derived R2 keys go to this same item.
    expect(token?.vault_item_id).toBe("du6dxzjfiml7f7qnj2peyff3ba");
  });
});
