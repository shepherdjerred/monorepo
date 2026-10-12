import { z } from "zod";
import catalogJson from "#tofu/application-secrets/desired-state.json" with { type: "json" };

export const CredentialTargetSchema = z.strictObject({
  vault_item_id: z.string().min(1),
  vault_field: z.string().min(1),
  vault_section_id: z.string().min(1).optional(),
  vault_field_id: z.string().min(1).optional(),
  vault_json_path: z
    .string()
    .regex(/^(?:\/(?:[^~/]|~[01])*)+$/u)
    .optional(),
});
export type CredentialTarget = z.infer<typeof CredentialTargetSchema>;

const ApplicationTargetSchema = CredentialTargetSchema.extend({
  vault_item_id: z.string().regex(/^[a-z0-9]{26}$/u),
  vault_field_id: z.string().min(1),
});

function ownershipConflict(
  left: CredentialTarget,
  right: CredentialTarget,
): boolean {
  const sameField = !(
    left.vault_item_id.toLowerCase() !== right.vault_item_id.toLowerCase() ||
    left.vault_section_id?.toLowerCase() !==
      right.vault_section_id?.toLowerCase() ||
    (left.vault_field_id ?? left.vault_field).toLowerCase() !==
      (right.vault_field_id ?? right.vault_field).toLowerCase()
  );
  return (
    sameField &&
    (left.vault_json_path === undefined ||
      right.vault_json_path === undefined ||
      left.vault_json_path === right.vault_json_path ||
      left.vault_json_path.startsWith(`${right.vault_json_path}/`) ||
      right.vault_json_path.startsWith(`${left.vault_json_path}/`))
  );
}

export const ApplicationSecretsSchema = z
  .strictObject({
    $schema: z.literal("./desired-state.schema.json"),
    credentials: z.record(
      z.string().regex(/^[a-z][a-z0-9_]*$/u),
      z.strictObject({
        revision: z.number().int().nonnegative(),
        environment: z.enum(["production", "beta", "shared"]),
        consumer_probe: z.string().min(1),
        onepassword_targets: z.array(ApplicationTargetSchema).min(1),
      }),
    ),
  })
  .superRefine(({ credentials }, ctx) => {
    const seen: CredentialTarget[] = [];
    for (const credential of Object.values(credentials)) {
      for (const target of credential.onepassword_targets) {
        if (seen.some((previous) => ownershipConflict(previous, target)))
          ctx.addIssue({
            code: "custom",
            message: "A field belongs to multiple rotation units",
          });
        seen.push(target);
      }
    }
  });

export const applicationSecrets = ApplicationSecretsSchema.parse(catalogJson);
export const applicationTargets = Object.values(
  applicationSecrets.credentials,
).flatMap((unit) => unit.onepassword_targets);

export function assertPreparationAction(action: string): void {
  if (action !== "preview" && action !== "verify")
    throw new Error(
      "This phase supports preview and verify only; writes, imports, applies and cleanup are disabled.",
    );
}

export function jsonCredential(
  value: string,
  jsonPath: string,
): string | undefined {
  let node: unknown;
  try {
    node = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!/^(?:\/(?:[^~/]|~[01])*)+$/u.test(jsonPath)) return undefined;
  for (const encoded of jsonPath.slice(1).split("/")) {
    const segment = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(node)) {
      if (!/^(?:0|[1-9]\d*)$/u.test(segment)) return undefined;
      node = node[Number(segment)];
      continue;
    }
    const object = z.record(z.string(), z.unknown()).safeParse(node);
    if (!object.success) return undefined;
    node = object.data[segment];
  }
  return typeof node === "string" && node.length > 0 ? node : undefined;
}
