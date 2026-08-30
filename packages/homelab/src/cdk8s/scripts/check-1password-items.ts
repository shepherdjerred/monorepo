#!/usr/bin/env bun
/**
 * 1Password item & field linter (offline, no credentials).
 *
 * Synthesizes the cdk8s app in-memory, collects every `OnePasswordItem` reference and
 * every Kubernetes secret field consumed from those items, and verifies them against the
 * committed snapshot of vault structure ([onepassword-vault-snapshot.json](../onepassword-vault-snapshot.json)).
 *
 * It guarantees that every referenced 1Password item exists, and that every referenced
 * field (operator-emitted secret key) exists on that item — without ever touching 1Password.
 * Refresh the snapshot with [snapshot-1password-vault.ts](./snapshot-1password-vault.ts).
 *
 * Usage: bun run scripts/check-1password-items.ts
 *
 * Exit codes:
 *   0 - all referenced items and fields exist in the snapshot
 *   1 - one or more items/fields missing, or a malformed itemPath
 *   2 - setup error (synth failed, snapshot missing/unparseable)
 */

import { App } from "cdk8s";
import { z } from "zod";
import { setupCharts } from "@shepherdjerred/homelab/cdk8s/src/setup-charts.ts";
import {
  collectOnePasswordTargets,
  loadPlatformDesiredState,
  type OnePasswordTarget,
  type PlatformStack,
} from "../../../scripts/platform-desired-state.ts";
import {
  hash,
  SnapshotSchema,
  SNAPSHOT_PATH,
  VAULT_ID,
  type Snapshot,
  type SnapshotItem,
} from "./onepassword-lib.ts";

const ITEM_PATH_RE = /^vaults\/([^/]+)\/items\/(.+)$/;
/**
 * How long a snapshot may go unrefreshed before this check says so. Long
 * enough that a quiet vault does not nag, short enough that a snapshot from
 * before a credential change is called out.
 */
const SNAPSHOT_MAX_AGE_DAYS = 45;

const PLATFORM_STACKS: readonly PlatformStack[] = [
  "openai",
  "anthropic",
  "discord",
  "openrouter",
  "cloudflare-tokens",
];

type OpItemRef = { namespace: string; name: string; itemPath: string };
/** ns -> secretName -> specific data keys read from that secret. */
type Consumption = Map<string, Map<string, Set<string>>>;

const RecordSchema = z.record(z.string(), z.unknown());
const SecretKeyRefSchema = z.object({
  name: z.string(),
  key: z.string(),
  optional: z.boolean().optional(),
});
const SecretVolumeSchema = z.object({
  secretName: z.string(),
  items: z.array(z.object({ key: z.string() })).optional(),
});
const ManifestSchema = z.object({
  apiVersion: z.string().optional(),
  kind: z.string().optional(),
  metadata: z
    .object({ name: z.string().optional(), namespace: z.string().optional() })
    .optional(),
  spec: z
    .object({
      itemPath: z.string().optional(),
      // ArgoCD Application: the workload (and its consumed secrets) lives in the
      // destination namespace, not the Application's own metadata.namespace.
      destination: z.object({ namespace: z.string().optional() }).optional(),
    })
    .optional(),
});

function nsKey(namespace: string | undefined): string {
  return namespace ?? "";
}

function addKey(
  into: Map<string, Set<string>>,
  secretName: string,
  key: string,
): void {
  let keys = into.get(secretName);
  if (keys === undefined) {
    keys = new Set();
    into.set(secretName, keys);
  }
  keys.add(key);
}

/** Recursively collect specific secret-key consumption (secretKeyRef + volume secret items). */
function collectConsumption(
  node: unknown,
  into: Map<string, Set<string>>,
): void {
  if (Array.isArray(node)) {
    for (const value of node) collectConsumption(value, into);
    return;
  }
  const record = RecordSchema.safeParse(node);
  if (!record.success) return;
  const object = record.data;

  // env[].valueFrom.secretKeyRef: { name, key, optional? }. An optional ref tolerates a
  // missing key by design, so it does not require the field to exist.
  const skr = SecretKeyRefSchema.safeParse(object["secretKeyRef"]);
  if (skr.success && skr.data.optional !== true)
    addKey(into, skr.data.name, skr.data.key);

  // volumes[].secret: { secretName, items?: [{ key }] }
  const secret = SecretVolumeSchema.safeParse(object["secret"]);
  if (secret.success) {
    for (const item of secret.data.items ?? [])
      addKey(into, secret.data.secretName, item.key);
  }

  for (const value of Object.values(object)) collectConsumption(value, into);
}

async function synthManifests(): Promise<unknown[]> {
  const app = new App();
  await setupCharts(app);
  const manifests: unknown[] = [];
  for (const chart of app.charts) {
    manifests.push(...z.array(z.unknown()).parse(chart.toJson()));
  }
  return manifests;
}

function fail(message: string, code: 1 | 2): never {
  console.error(message);
  process.exit(code);
}

async function loadSnapshot(): Promise<Snapshot> {
  const file = Bun.file(SNAPSHOT_PATH);
  if (!(await file.exists())) {
    fail(
      `check-1password-items: snapshot not found at ${SNAPSHOT_PATH}\n` +
        `  Run: bun run scripts/snapshot-1password-vault.ts  (requires 1Password access)`,
      2,
    );
  }
  let raw: unknown;
  try {
    raw = await file.json();
  } catch (error) {
    // Invalid JSON (e.g. unresolved merge-conflict markers) throws here, before
    // safeParse can run — surface it as a clean exit 2 instead of an unhandled rejection.
    const message = error instanceof Error ? error.message : String(error);
    fail(
      `check-1password-items: snapshot is not valid JSON (${message}).\n` +
        `  If it contains merge-conflict markers, resolve them and re-run scripts/snapshot-1password-vault.ts.`,
      2,
    );
  }
  const parsed = SnapshotSchema.safeParse(raw);
  if (!parsed.success)
    fail(
      `check-1password-items: snapshot is malformed: ${parsed.error.message}`,
      2,
    );
  if (parsed.data.vaultId !== VAULT_ID)
    fail(
      `check-1password-items: snapshot is for vault "${parsed.data.vaultId}", expected ${VAULT_ID}. ` +
        `Regenerate it with scripts/snapshot-1password-vault.ts.`,
      2,
    );
  return parsed.data;
}

function collectReferences(manifests: unknown[]): {
  opItems: OpItemRef[];
  consumption: Consumption;
} {
  const opItems: OpItemRef[] = [];
  const consumption: Consumption = new Map();

  for (const raw of manifests) {
    const parsed = ManifestSchema.safeParse(raw);
    if (!parsed.success) continue;
    const manifest = parsed.data;
    const namespace = nsKey(manifest.metadata?.namespace);

    if (manifest.kind === "OnePasswordItem") {
      const name = manifest.metadata?.name;
      const itemPath = manifest.spec?.itemPath;
      if (name !== undefined && itemPath !== undefined)
        opItems.push({ namespace, name, itemPath });
      continue;
    }

    // An ArgoCD Application's own metadata.namespace is `argocd`, but the
    // secretKeyRefs embedded in its helm valuesObject are consumed by the
    // workload in spec.destination.namespace, where the OnePasswordItem lives.
    // Bucket the Application's consumption there so validateFields can join it
    // to the item (otherwise these refs are silently never checked).
    const isArgoApp =
      manifest.kind === "Application" &&
      (manifest.apiVersion?.startsWith("argoproj.io/") ?? false);
    const consumptionNamespace = isArgoApp
      ? nsKey(manifest.spec?.destination?.namespace)
      : namespace;

    let nsConsumption = consumption.get(consumptionNamespace);
    if (nsConsumption === undefined) {
      nsConsumption = new Map();
      consumption.set(consumptionNamespace, nsConsumption);
    }
    collectConsumption(raw, nsConsumption);
  }

  return { opItems, consumption };
}

/** Verify each OnePasswordItem exists in the snapshot; return the resolved entry per (ns,name). */
function validateItems(
  opItems: OpItemRef[],
  byHash: Map<string, SnapshotItem>,
  errors: string[],
): Map<string, SnapshotItem> {
  const resolved = new Map<string, SnapshotItem>();
  for (const item of opItems) {
    const match = ITEM_PATH_RE.exec(item.itemPath);
    if (match === null) {
      errors.push(
        `malformed itemPath "${item.itemPath}" on OnePasswordItem ${item.namespace}/${item.name}`,
      );
      continue;
    }
    const [, vaultId, itemRef] = match;
    if (vaultId !== VAULT_ID) {
      errors.push(
        `unexpected vault "${vaultId ?? ""}" on OnePasswordItem ${item.namespace}/${item.name} (expected ${VAULT_ID})`,
      );
      continue;
    }
    if (itemRef === undefined) continue;
    const entry = byHash.get(hash(itemRef));
    if (entry === undefined) {
      errors.push(
        `1Password item not found in vault: "${itemRef}" (OnePasswordItem ${item.namespace}/${item.name}). ` +
          `If it was just added/renamed, refresh the snapshot.`,
      );
      continue;
    }
    resolved.set(`${item.namespace} ${item.name}`, entry);
  }
  return resolved;
}

/** Verify each field read from a resolved 1Password-backed secret exists on its item. */
function validateFields(
  consumption: Consumption,
  resolved: Map<string, SnapshotItem>,
  errors: string[],
): number {
  let checked = 0;
  for (const [namespace, secrets] of consumption) {
    for (const [secretName, keys] of secrets) {
      const entry = resolved.get(`${namespace} ${secretName}`);
      if (entry === undefined) continue; // not a (resolved) 1Password-backed secret
      for (const key of [...keys].toSorted()) {
        checked += 1;
        const keyHash = hash(key);
        if (!entry.fields.includes(keyHash)) {
          errors.push(
            `field "${key}" not found on 1Password item backing secret ${namespace}/${secretName}. ` +
              `If it was just added/renamed, refresh the snapshot.`,
          );
        } else if (entry.blankFields.includes(keyHash)) {
          errors.push(
            `field "${key}" is BLANK (empty value) on the 1Password item backing secret ${namespace}/${secretName}. ` +
              `The operator skips empty fields, so this required env var would be missing at deploy. ` +
              `Populate it in 1Password, or mark the secretKeyRef optional if it is genuinely optional.`,
          );
        }
      }
    }
  }
  return checked;
}

type DesiredStateTarget = {
  platform: PlatformStack;
  target: OnePasswordTarget;
};

async function collectDesiredStateTargets(): Promise<
  readonly DesiredStateTarget[]
> {
  const targets: DesiredStateTarget[] = [];
  for (const platform of PLATFORM_STACKS) {
    const stackDir = new URL(`../../tofu/${platform}/`, import.meta.url)
      .pathname;
    const desiredState = await loadPlatformDesiredState(stackDir, platform);
    for (const target of collectOnePasswordTargets(desiredState)) {
      targets.push({ platform, target });
    }
  }
  return targets;
}

/** Verify desired-state rotation units against the same hashed vault snapshot. */
function validateDesiredStateTargets(
  targets: readonly DesiredStateTarget[],
  byHash: Map<string, SnapshotItem>,
  errors: string[],
): number {
  let checked = 0;
  for (const { platform, target } of targets) {
    checked += 1;
    const entry = byHash.get(hash(target.vault_item_id));
    if (entry === undefined) {
      errors.push(
        `1Password handoff item not found in ${platform} desired state: "${target.vault_item_id}". ` +
          `If it was just added or renamed, refresh the snapshot.`,
      );
      continue;
    }
    if (
      target.vault_field !== undefined &&
      !entry.fields.includes(hash(target.vault_field))
    ) {
      errors.push(
        `1Password handoff field "${target.vault_field}" not found on item "${target.vault_item_id}" in ${platform} desired state. ` +
          `If it was just added or renamed, refresh the snapshot.`,
      );
    }
  }
  return checked;
}

async function main(): Promise<void> {
  let manifests: unknown[];
  try {
    manifests = await synthManifests();
  } catch (error) {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    fail(`check-1password-items: cdk8s synth failed:\n${message}`, 2);
  }

  const { opItems, consumption } = collectReferences(manifests);
  const snapshot = await loadSnapshot();
  let desiredStateTargets: readonly DesiredStateTarget[];
  try {
    desiredStateTargets = await collectDesiredStateTargets();
  } catch (error) {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    fail(
      `check-1password-items: desired-state validation failed:\n${message}`,
      2,
    );
  }

  // An itemPath may reference an item by id OR by human-readable title; index both.
  const byHash = new Map<string, SnapshotItem>();
  for (const entry of snapshot.items) {
    byHash.set(entry.ref, entry);
    byHash.set(entry.title, entry);
  }

  const errors: string[] = [];
  const resolved = validateItems(opItems, byHash, errors);
  const fieldsChecked = validateFields(consumption, resolved, errors);
  const desiredStateTargetsChecked = validateDesiredStateTargets(
    desiredStateTargets,
    byHash,
    errors,
  );

  if (errors.length > 0) {
    console.error(
      `check-1password-items: ${String(errors.length)} problem(s):\n`,
    );
    for (const error of errors.toSorted()) console.error(`  ✗ ${error}`);
    console.error(
      `\nSnapshot generated at ${snapshot.generatedAt}. Refresh with snapshot-1password-vault.ts.`,
    );
    process.exit(1);
  }

  console.log(
    `check-1password-items: OK — ${String(opItems.length)} item references and ${String(fieldsChecked)} ` +
      `field references plus ${String(desiredStateTargetsChecked)} desired-state handoffs ` +
      `verified against the vault snapshot (${String(snapshot.items.length)} items).`,
  );
  warnIfSnapshotIsStale(snapshot.generatedAt);
}

/**
 * This check is only as truthful as the snapshot it reads. A field added or
 * populated in 1Password after the last refresh is invisible here, so a clean
 * result on a months-old snapshot means "nothing contradicts a stale record",
 * not "the vault agrees". Warn rather than fail: the snapshot legitimately
 * ages between vault changes, and failing on the calendar would redden PRs
 * that touched nothing related.
 */
export function snapshotStalenessWarning(
  generatedAt: string,
  now: Date,
  maxAgeDays = SNAPSHOT_MAX_AGE_DAYS,
): string | null {
  const generated = Date.parse(generatedAt);
  if (Number.isNaN(generated)) {
    return `vault snapshot has an unparseable generatedAt (${generatedAt}); refresh it with snapshot-1password-vault.ts.`;
  }
  const ageDays = Math.floor(
    (now.getTime() - generated) / (24 * 60 * 60 * 1000),
  );
  if (ageDays <= maxAgeDays) return null;
  return (
    `vault snapshot is ${String(ageDays)} days old (generated ${generatedAt}). ` +
    `Fields added or populated since then are invisible to this check — refresh it with snapshot-1password-vault.ts.`
  );
}

function warnIfSnapshotIsStale(generatedAt: string): void {
  const warning = snapshotStalenessWarning(generatedAt, new Date());
  if (warning !== null) console.warn(`check-1password-items: ${warning}`);
}

// Guarded so the pure helpers above can be imported by tests without the
// checker synthesizing the whole cdk8s app as a side effect of the import.
if (import.meta.main) {
  await main();
}
