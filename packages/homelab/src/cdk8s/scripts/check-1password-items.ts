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
  hash,
  SnapshotSchema,
  SNAPSHOT_PATH,
  VAULT_ID,
  type Snapshot,
  type SnapshotItem,
} from "./onepassword-lib.ts";

const ITEM_PATH_RE = /^vaults\/([^/]+)\/items\/(.+)$/;

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
  kind: z.string().optional(),
  metadata: z
    .object({ name: z.string().optional(), namespace: z.string().optional() })
    .optional(),
  spec: z.object({ itemPath: z.string().optional() }).optional(),
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

    let nsConsumption = consumption.get(namespace);
    if (nsConsumption === undefined) {
      nsConsumption = new Map();
      consumption.set(namespace, nsConsumption);
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

  // An itemPath may reference an item by id OR by human-readable title; index both.
  const byHash = new Map<string, SnapshotItem>();
  for (const entry of snapshot.items) {
    byHash.set(entry.ref, entry);
    byHash.set(entry.title, entry);
  }

  const errors: string[] = [];
  const resolved = validateItems(opItems, byHash, errors);
  const fieldsChecked = validateFields(consumption, resolved, errors);

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
      `field references verified against the vault snapshot (${String(snapshot.items.length)} items).`,
  );
}

await main();
