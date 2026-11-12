import { describe, expect, test } from "vitest";
import { z } from "zod";
import { synthesize } from "#scripts/synth.ts";

const ConfigurationSchema = z.looseObject({
  terraform: z.looseObject({
    encryption: z.unknown(),
    required_version: z.string(),
    required_providers: z.record(
      z.string(),
      z.object({ source: z.string(), version: z.string() }),
    ),
  }),
  provider: z.record(z.string(), z.unknown()),
  variable: z.record(z.string(), z.record(z.string(), z.unknown())),
  locals: z.record(z.string(), z.unknown()),
  data: z.unknown().optional(),
  resource: z.record(
    z.string(),
    z.record(z.string(), z.record(z.string(), z.unknown())),
  ),
  import: z.array(z.record(z.string(), z.string())),
  output: z.record(z.string(), z.record(z.string(), z.unknown())),
  moved: z.unknown().optional(),
  removed: z.unknown().optional(),
});

async function applicationSecrets() {
  const synthesized = await synthesize();
  return ConfigurationSchema.parse(
    JSON.parse(synthesized.get("application-secrets") ?? ""),
  );
}

describe("application-secrets", () => {
  test("keeps the one for_each resource, read from the stack's own catalog", async () => {
    const { resource, locals, data } = await applicationSecrets();
    expect(Object.keys(resource)).toEqual(["random_password"]);
    expect(Object.keys(resource["random_password"] ?? {})).toEqual([
      "credentials",
    ]);
    expect(resource["random_password"]?.["credentials"]).toEqual({
      for_each: "${local.credentials}",
      length:
        "${each.value.revision == 0 ? lookup(var.adoption_lengths, each.key, 64) : 64}",
      upper: "${each.value.revision == 0}",
      lower: true,
      numeric: true,
      special: "${each.value.revision == 0}",
      min_lower: "${each.value.revision == 0 ? 0 : 1}",
      min_numeric: "${each.value.revision == 0 ? 0 : 1}",
      keepers:
        "${each.value.revision == 0 ? null : { revision = tostring(each.value.revision) }}",
      lifecycle: {
        precondition: [
          {
            condition:
              "${each.value.revision > 0 || contains(keys(var.adoption_lengths), each.key)}",
            error_message:
              "Revision zero requires verified adoption lengths; do not generate replacements during adoption.",
          },
        ],
      },
    });
    // The adoption fixture test swaps the catalog, so it stays a plan-time read.
    expect(locals).toEqual({
      credentials:
        '${jsondecode(file("${path.module}/desired-state.json")).credentials}',
    });
    expect(data).toBeUndefined();
  });

  test("keeps the import addresses adopt-application-secrets.ts verifies", async () => {
    const configuration = await applicationSecrets();
    // The adoption runner accepts a plan only when every change is at
    // random_password.credentials["<key>"]; the import must land there.
    expect(configuration.import).toEqual([
      {
        for_each: "${var.adoption_keys}",
        to: "random_password.credentials[each.key]",
        id: "${nonsensitive(var.adoption_values[each.key])}",
      },
    ]);
    expect(configuration.moved).toBeUndefined();
    expect(configuration.removed).toBeUndefined();
  });

  test("keeps the sensitive handoff output", async () => {
    const { output } = await applicationSecrets();
    expect(output).toEqual({
      application_secret_handoffs: {
        description:
          "Sensitive operator handoffs; the stack has no 1Password write provider.",
        sensitive: true,
        value:
          "${{ for key, credential in local.credentials : key => { value = random_password.credentials[key].result, revision = credential.revision, onepassword_targets = credential.onepassword_targets } }}",
      },
    });
  });

  test("keeps the variables, the provider constraint and the encryption its state was written with", async () => {
    const { variable, provider, terraform } = await applicationSecrets();
    expect(variable).toEqual({
      tofu_state_encryption_passphrase: {
        description:
          "Unique application-secrets state passphrase supplied by the operator.",
        type: "string",
        sensitive: true,
        validation: [
          {
            condition:
              "${(length(var.tofu_state_encryption_passphrase) >= 16)}",
            error_message:
              "State encryption requires a passphrase of at least 16 characters.",
          },
        ],
      },
      adoption_lengths: {
        description:
          "Nonsecret lengths inspected during adoption; retain for revision zero.",
        type: "map(number)",
        default: {},
      },
      adoption_keys: {
        description:
          "Explicit nonsecret keys to import, supplied only during initial adoption.",
        type: "set(string)",
        default: [],
      },
      adoption_values: {
        description:
          "Existing values passed in memory by the operator; never in argv or files.",
        type: "map(string)",
        sensitive: true,
        default: {},
      },
    });
    // The stack has no 1Password provider: handoffs are operator-run.
    expect(provider).toEqual({ random: [{}] });
    expect(terraform.required_providers).toEqual({
      random: { source: "hashicorp/random", version: "3.9.1" },
    });
    expect(terraform.required_version).toBe(">= 1.12.0");
    expect(terraform.encryption).toEqual({
      key_provider: {
        pbkdf2: {
          state: { passphrase: "${var.tofu_state_encryption_passphrase}" },
        },
      },
      method: {
        aes_gcm: { encrypted: { keys: "${key_provider.pbkdf2.state}" } },
      },
      state: { method: "method.aes_gcm.encrypted", enforced: true },
      plan: { method: "method.aes_gcm.encrypted", enforced: true },
    });
  });
});
