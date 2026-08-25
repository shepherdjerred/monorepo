import { createHash } from "node:crypto";
import { z } from "zod";

const NonBlankString = z.string().trim().min(1);
const SecretGrantSchema = z
  .object({
    env: NonBlankString,
    secret: NonBlankString,
    key: NonBlankString,
  })
  .strict();
export type SecretGrant = z.infer<typeof SecretGrantSchema>;

const SecretGrantManifestSchema = z
  .object({
    $schema: NonBlankString.optional(),
    secrets: z.record(
      NonBlankString,
      z.object({ itemId: NonBlankString }).strict(),
    ),
    pipelines: z.record(
      NonBlankString,
      z.record(NonBlankString, z.array(SecretGrantSchema)),
    ),
  })
  .strict()
  .superRefine((manifest, context) => {
    for (const [pipeline, steps] of Object.entries(manifest.pipelines)) {
      for (const [step, grants] of Object.entries(steps)) {
        const envNames = new Set<string>();
        for (const [index, grant] of grants.entries()) {
          if (envNames.has(grant.env)) {
            context.addIssue({
              code: "custom",
              path: ["pipelines", pipeline, step, index, "env"],
              message: `duplicate environment variable ${grant.env}`,
            });
          }
          envNames.add(grant.env);
          if (manifest.secrets[grant.secret] === undefined) {
            context.addIssue({
              code: "custom",
              path: ["pipelines", pipeline, step, index, "secret"],
              message: `unknown Secret ${grant.secret}`,
            });
          }
        }
      }
    }
  });
export type SecretGrantManifest = z.infer<typeof SecretGrantManifestSchema>;

const SnapshotItemSchema = z.object({
  ref: NonBlankString,
  title: NonBlankString,
  fields: z.array(NonBlankString),
  blankFields: z.array(NonBlankString),
});
const SnapshotSchema = z.object({
  vaultId: NonBlankString,
  generatedAt: NonBlankString,
  items: z.array(SnapshotItemSchema),
});
export type VaultSnapshot = z.infer<typeof SnapshotSchema>;

export function parseSecretGrantManifest(input: unknown): SecretGrantManifest {
  return SecretGrantManifestSchema.parse(input);
}

export function parseVaultSnapshot(input: unknown): VaultSnapshot {
  return SnapshotSchema.parse(input);
}

export function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function declaredSecretItems(source: string): Map<string, string> {
  const declarations = new Map<string, string>();
  const catalogEntry = /secretName:\s*"([^"]+)"[\s\S]*?itemId:\s*"([^"]+)"/gu;
  for (const match of source.matchAll(catalogEntry)) {
    const secret = match[1];
    const itemId = match[2];
    if (secret !== undefined && itemId !== undefined) {
      declarations.set(secret, itemId);
    }
  }
  const directItem =
    /new OnePasswordItem\(chart,\s*"([^"]+)"[\s\S]*?itemPath:\s*"vaults\/[^"]+\/items\/([^"]+)"/gu;
  for (const match of source.matchAll(directItem)) {
    const secret = match[1];
    const itemId = match[2];
    if (secret !== undefined && itemId !== undefined) {
      declarations.set(secret, itemId);
    }
  }
  return declarations;
}

function grantFieldsForSecret(
  manifest: SecretGrantManifest,
  secret: string,
): Set<string> {
  const fields = new Set<string>();
  for (const steps of Object.values(manifest.pipelines)) {
    for (const grants of Object.values(steps)) {
      for (const grant of grants) {
        if (grant.secret === secret) fields.add(grant.key);
      }
    }
  }
  return fields;
}

export function validateGrantCatalog(input: {
  manifest: SecretGrantManifest;
  snapshot: VaultSnapshot;
  declarationSource: string;
}): string[] {
  const errors: string[] = [];
  const declared = declaredSecretItems(input.declarationSource);
  const snapshotByRef = new Map(
    input.snapshot.items.map((item) => [item.ref, item]),
  );
  for (const [secret, { itemId }] of Object.entries(input.manifest.secrets)) {
    if (declared.get(secret) !== itemId) {
      errors.push(
        `Secret ${secret} is not declared against manifest item ${itemId}`,
      );
    }
    const item = snapshotByRef.get(hash(itemId));
    if (item === undefined) {
      errors.push(`Secret ${secret} item is absent from the vault snapshot`);
      continue;
    }
    const fields = new Set(item.fields);
    const blanks = new Set(item.blankFields);
    for (const key of grantFieldsForSecret(input.manifest, secret)) {
      const fieldHash = hash(key);
      if (!fields.has(fieldHash)) {
        errors.push(`Secret ${secret} has unknown field ${key}`);
      } else if (blanks.has(fieldHash)) {
        errors.push(`Secret ${secret} field ${key} is blank`);
      }
    }
  }
  return [...new Set(errors)].toSorted();
}
