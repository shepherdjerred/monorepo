import { expect, test } from "vitest";
import { z } from "zod";
import { synthesize } from "#scripts/synth.ts";
import { HOMELAB_VAULT_ID } from "#src/onepassword.ts";

const ConfigurationSchema = z.looseObject({
  terraform: z.looseObject({
    encryption: z.unknown(),
    required_providers: z.record(
      z.string(),
      z.object({ source: z.string(), version: z.string() }),
    ),
    required_version: z.string(),
  }),
  locals: z.record(z.string(), z.unknown()),
  variable: z.record(z.string(), z.unknown()),
  resource: z.record(z.string(), z.record(z.string(), z.unknown())),
  output: z.record(z.string(), z.unknown()),
});

async function backblaze() {
  const synthesized = await synthesize();
  return ConfigurationSchema.parse(
    JSON.parse(synthesized.get("backblaze") ?? ""),
  );
}

const KEYS = ["postgres_wal", "seaweedfs_backups", "velero"];

const KEY_ID = "${b2_application_key.backup[each.key].application_key_id}";
const SECRET = "${b2_application_key.backup[each.key].application_key}";

test("backblaze keeps the bucket, key and item addresses of its state", async () => {
  const { resource, output, locals } = await backblaze();
  expect(Object.keys(resource).toSorted()).toEqual([
    "b2_application_key",
    "b2_bucket",
    "onepassword_item",
  ]);
  expect(Object.keys(resource["b2_bucket"] ?? {}).toSorted()).toEqual(KEYS);
  expect(Object.keys(resource["b2_application_key"] ?? {})).toEqual(["backup"]);
  expect(Object.keys(resource["onepassword_item"] ?? {})).toEqual(["backup"]);
  expect(Object.keys(output).toSorted()).toEqual([
    "bucket_names",
    "region",
    "s3_endpoint",
  ]);
  expect(locals).toEqual({
    bucket_ids: Object.fromEntries(
      KEYS.map((key) => [key, `\${b2_bucket.${key}.bucket_id}`]),
    ),
  });
});

test("every bucket is private, protected and expires only hidden versions", async () => {
  const { resource } = await backblaze();
  const buckets = resource["b2_bucket"] ?? {};
  for (const key of KEYS) {
    expect(buckets[key], key).toMatchObject({
      bucket_type: "allPrivate",
      lifecycle: { prevent_destroy: true },
      lifecycle_rules: [
        {
          file_name_prefix: "",
          days_from_starting_to_canceling_unfinished_large_files: 7,
          days_from_hiding_to_deleting: 30,
        },
      ],
    });
  }
  // Only seaweedfs-backups has File Lock, and none has a default retention.
  expect(buckets["seaweedfs_backups"]).toMatchObject({
    file_lock_configuration: [{ is_file_lock_enabled: true }],
  });
  expect(buckets["velero"]).not.toHaveProperty("file_lock_configuration");
  expect(buckets["postgres_wal"]).not.toHaveProperty("file_lock_configuration");
});

test("each scoped key is written to its own item, with Velero's credentials file after the key fields", async () => {
  const { resource } = await backblaze();
  const key = z
    .looseObject({ for_each: z.record(z.string(), z.unknown()) })
    .parse(resource["b2_application_key"]?.["backup"]);
  expect(Object.keys(key.for_each).toSorted()).toEqual(KEYS);
  expect(key).toMatchObject({
    key_name: "${each.value.title}",
    capabilities: "${each.value.capabilities}",
    bucket_ids: ["${local.bucket_ids[each.key]}"],
  });
  expect(resource["onepassword_item"]?.["backup"]).toEqual({
    for_each: key.for_each,
    vault: HOMELAB_VAULT_ID,
    title: "${each.value.title}",
    category: "secure_note",
    section: [
      {
        label: "credentials",
        // One ordered list: a literal `field` beside a `dynamic` one would
        // be expanded after it, because cdktn sorts `dynamic` first.
        dynamic: {
          field: [
            {
              for_each: [true],
              content: {
                label: "B2_ACCESS_KEY_ID",
                type: "CONCEALED",
                value: KEY_ID,
              },
            },
            {
              for_each: [true],
              content: {
                label: "B2_SECRET_ACCESS_KEY",
                type: "CONCEALED",
                value: SECRET,
              },
            },
            {
              for_each: "${each.value.aws_credentials_file ? [true] : []}",
              content: {
                label: "cloud",
                type: "CONCEALED",
                value: `[default]\naws_access_key_id=${KEY_ID}\naws_secret_access_key=${SECRET}\n`,
              },
            },
          ],
        },
      },
    ],
  });
});

test("backblaze encrypts state and plans and keeps its lock constraints", async () => {
  const { terraform, variable, ...rest } = await backblaze();
  expect(Object.keys(variable)).toEqual(["tofu_state_encryption_passphrase"]);
  expect(variable["tofu_state_encryption_passphrase"]).toMatchObject({
    description: "Passphrase encrypting Backblaze state and plans.",
    sensitive: true,
  });
  expect(terraform.encryption).toMatchObject({
    state: { method: "method.aes_gcm.encrypted", enforced: true },
    plan: { method: "method.aes_gcm.encrypted", enforced: true },
  });
  // The lock file records these constraints; a different one rewrites it.
  expect(terraform.required_providers).toEqual({
    b2: { source: "backblaze/b2", version: "0.14.0" },
    onepassword: { source: "1password/onepassword", version: "~> 3.0" },
  });
  expect(terraform.required_version).toBe(">= 1.11.0");
  expect(rest).not.toHaveProperty("import");
  expect(rest).not.toHaveProperty("moved");
  expect(rest).not.toHaveProperty("removed");
});
