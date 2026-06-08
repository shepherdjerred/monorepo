/**
 * Shared helpers for the 1Password item/field linter and its snapshot refresher.
 *
 * The linter ([check-1password-items.ts](./check-1password-items.ts)) is fully
 * offline: it validates the cdk8s-synthesized 1Password references against a
 * committed snapshot of vault structure. The refresher
 * ([snapshot-1password-vault.ts](./snapshot-1password-vault.ts)) is the only
 * piece that talks to 1Password. The operator's field-label -> secret-key transform
 * (`formatSecretDataName`) lives here so both sides hash identical keys.
 */

import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";

/**
 * The single homelab 1Password vault id. Mirrors the (intentionally unexported)
 * constant in [misc/onepassword-vault.ts](../src/misc/onepassword-vault.ts); kept
 * here as a plain string (a vault id is not a secret). The linter asserts every
 * `OnePasswordItem.spec.itemPath` uses this vault.
 */
export const VAULT_ID = "v64ocnykdqju4ui6j6pua56xw4";

/** Absolute path to the committed snapshot consumed by the linter. */
export const SNAPSHOT_PATH = path.join(
  import.meta.dir,
  "..",
  "onepassword-vault-snapshot.json",
);

/** Hex sha256 of a UTF-8 string. Used to keep vault names out of the repo in plaintext. */
export function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// --- 1Password operator field-label -> secret-key transform ---------------------
// Faithful port of formatSecretDataName / createValidSecretDataName from
// github.com/1Password/onepassword-operator pkg/kubernetessecrets/kubernetes_secrets_builder.go
// (commit on `main`, 2026-06). The operator builds each k8s Secret data key from the
// 1Password *field label* (not id): valid keys pass through verbatim (case preserved),
// otherwise leading/trailing invalid chars are stripped and internal invalid runs are
// collapsed to a single "-".

// `\w` is [A-Za-z0-9_]; with `-` and `.` this is exactly the operator's valid key set.
const VALID_DATA_KEY = /^[-.\w]+$/;
const INVALID_DATA_CHARS = /[^-.\w]+/g;
const INVALID_START_END_CHARS = /^[^-.\w]+|[^-.\w]+$/g;
// k8s ConfigMap/Secret key max length (DNS1123SubdomainMaxLength in the operator).
const MAX_KEY_LENGTH = 253;

/** True when `value` is already a valid k8s Secret data key (operator's IsConfigMapKey). */
function isValidDataKey(value: string): boolean {
  if (value === "." || value === "..") return false;
  if (value.length === 0 || value.length > MAX_KEY_LENGTH) return false;
  return VALID_DATA_KEY.test(value);
}

/**
 * Transform a 1Password field label (or URL label / file name) into the Kubernetes
 * Secret data key the operator would emit. Returns "" when the operator would skip it
 * (label reduces to nothing valid).
 */
export function formatSecretDataName(value: string): string {
  if (isValidDataKey(value)) return value;
  let result = value.replaceAll(INVALID_START_END_CHARS, "");
  result = result.replaceAll(INVALID_DATA_CHARS, "-");
  if (result.length > MAX_KEY_LENGTH) result = result.slice(0, MAX_KEY_LENGTH);
  return result;
}

// --- Snapshot file schema -------------------------------------------------------

export const SnapshotItemSchema = z.object({
  /** sha256 of the 1Password item id. */
  ref: z.string(),
  /** sha256 of the 1Password item title (items are referenced by id OR title). */
  title: z.string(),
  /** Sorted sha256 hashes of the operator-emitted secret keys for this item. */
  fields: z.array(z.string()),
});
export type SnapshotItem = z.infer<typeof SnapshotItemSchema>;

export const SnapshotSchema = z.object({
  vaultId: z.string(),
  /** ISO timestamp of when the snapshot was generated. Metadata only. */
  generatedAt: z.string(),
  items: z.array(SnapshotItemSchema),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

// --- `op item ... --format json` schemas (used only by the refresher) -----------

const OpFieldSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  value: z.string().optional(),
  type: z.string().optional(),
});

const OpUrlSchema = z.object({
  label: z.string().optional(),
  href: z.string().optional(),
  primary: z.boolean().optional(),
});

const OpFileSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
});

export const OpItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  fields: z.array(OpFieldSchema).optional(),
  urls: z.array(OpUrlSchema).optional(),
  files: z.array(OpFileSchema).optional(),
});
export type OpItem = z.infer<typeof OpItemSchema>;

export const OpItemListSchema = z.array(
  z.object({ id: z.string(), title: z.string() }),
);

/**
 * Compute the set of Kubernetes Secret data keys an item *can* expose — every field
 * label, URL label, and file name run through {@link formatSecretDataName} (the same
 * key the operator's BuildKubernetesSecretData would emit).
 *
 * This intentionally tracks field *existence* (the label is present), independent of
 * whether the field currently holds a value. The linter answers "does this field exist
 * on the item?", per the request; it does not assert the field is populated (values are
 * volatile and never enter the snapshot). The operator additionally skips empty-valued
 * fields at sync time, but that is a deployment/population concern, not existence.
 */
export function operatorSecretKeys(item: OpItem): Set<string> {
  const keys = new Set<string>();
  const add = (label: string | undefined): void => {
    if (label === undefined) return;
    const key = formatSecretDataName(label);
    if (key !== "") keys.add(key);
  };
  for (const field of item.fields ?? []) add(field.label);
  for (const url of item.urls ?? []) add(url.label);
  for (const file of item.files ?? []) add(file.name);
  return keys;
}
