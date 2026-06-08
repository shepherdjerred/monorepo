#!/usr/bin/env bun
/**
 * Refresh the committed 1Password vault snapshot consumed by the offline linter
 * ([check-1password-items.ts](./check-1password-items.ts)).
 *
 * This is the ONLY piece that talks to 1Password. Run it whenever vault items or fields
 * change. It writes ONLY sha256 hashes of item ids, item titles, and the operator-emitted
 * secret keys — never any field values — so the committed file leaks no vault contents.
 *
 * Transport (auto-detected):
 *   - 1Password Connect HTTP API, if OP_CONNECT_TOKEN and OP_CONNECT_URL are set
 *     (works in-cluster, or locally via `kubectl port-forward svc/onepassword-connect -n 1password 8080:8080`).
 *   - `op` CLI otherwise (uses your local login; set OP_SERVICE_ACCOUNT_TOKEN to run non-interactively).
 *
 * Usage: bun run scripts/snapshot-1password-vault.ts
 *
 * Exit codes:
 *   0 - snapshot written
 *   2 - transport/auth error
 */

import {
  hash,
  operatorSecretKeys,
  OpItemListSchema,
  OpItemSchema,
  SNAPSHOT_PATH,
  VAULT_ID,
  type OpItem,
  type Snapshot,
  type SnapshotItem,
} from "./onepassword-lib.ts";

const CONCURRENCY = 8;
const MAX_RETRIES = 3;

function die(message: string): never {
  console.error(message);
  process.exit(2);
}

/** Retry a flaky network operation with exponential backoff. */
async function withRetry<T>(attempt: () => Promise<T>): Promise<T> {
  for (let tries = 0; ; tries += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (tries >= MAX_RETRIES - 1) throw error;
      await Bun.sleep(1000 * 2 ** tries);
    }
  }
}

/** Fetch every id with bounded concurrency; order of results is irrelevant (snapshot is sorted). */
async function fetchAll(
  ids: string[],
  fetchOne: (id: string) => Promise<OpItem>,
): Promise<OpItem[]> {
  const out: OpItem[] = [];
  for (let start = 0; start < ids.length; start += CONCURRENCY) {
    const chunk = ids.slice(start, start + CONCURRENCY);
    out.push(
      ...(await Promise.all(chunk.map((id) => withRetry(() => fetchOne(id))))),
    );
    console.error(
      `  ...${String(Math.min(start + CONCURRENCY, ids.length))}/${String(ids.length)}`,
    );
  }
  return out;
}

// --- op CLI transport -----------------------------------------------------------

async function op(args: string[]): Promise<string> {
  const proc = Bun.spawn(["op", ...args], { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(
      `op ${args.join(" ")} failed (exit ${String(exitCode)}): ${stderr.trim()}`,
    );
  }
  return stdout;
}

async function fetchViaOpCli(): Promise<OpItem[]> {
  const listRaw: unknown = JSON.parse(
    await withRetry(() =>
      op(["item", "list", "--vault", VAULT_ID, "--format", "json"]),
    ),
  );
  const list = OpItemListSchema.parse(listRaw);
  console.error(`Fetching ${String(list.length)} items via op CLI...`);
  return fetchAll(
    list.map((entry) => entry.id),
    async (id) =>
      OpItemSchema.parse(
        JSON.parse(
          await op([
            "item",
            "get",
            id,
            "--vault",
            VAULT_ID,
            "--format",
            "json",
          ]),
        ),
      ),
  );
}

// --- Connect HTTP transport -----------------------------------------------------

async function connectGet(
  baseUrl: string,
  token: string,
  path: string,
): Promise<unknown> {
  const response = await fetch(`${baseUrl}/v1${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `1Password Connect GET ${path} failed: HTTP ${String(response.status)} ${response.statusText}`,
    );
  }
  return response.json();
}

async function fetchViaConnect(
  baseUrl: string,
  token: string,
): Promise<OpItem[]> {
  const list = OpItemListSchema.parse(
    await withRetry(() =>
      connectGet(baseUrl, token, `/vaults/${VAULT_ID}/items`),
    ),
  );
  console.error(
    `Fetching ${String(list.length)} items via 1Password Connect...`,
  );
  return fetchAll(
    list.map((entry) => entry.id),
    async (id) =>
      OpItemSchema.parse(
        await connectGet(baseUrl, token, `/vaults/${VAULT_ID}/items/${id}`),
      ),
  );
}

// --- snapshot assembly ----------------------------------------------------------

function buildSnapshot(items: OpItem[]): Snapshot {
  const snapshotItems: SnapshotItem[] = items
    .map((item) => ({
      ref: hash(item.id),
      title: hash(item.title),
      fields: [...operatorSecretKeys(item)].map((key) => hash(key)).toSorted(),
    }))
    .toSorted((a, b) => a.ref.localeCompare(b.ref));

  return {
    vaultId: VAULT_ID,
    generatedAt: new Date().toISOString(),
    items: snapshotItems,
  };
}

async function main(): Promise<void> {
  const connectToken = Bun.env["OP_CONNECT_TOKEN"];
  const connectUrl = Bun.env["OP_CONNECT_URL"];
  const useConnect =
    connectToken !== undefined &&
    connectToken !== "" &&
    connectUrl !== undefined &&
    connectUrl !== "";

  const items = await (useConnect
    ? fetchViaConnect(connectUrl.replace(/\/$/, ""), connectToken)
    : fetchViaOpCli());

  if (items.length === 0) {
    die(
      "No items returned from the vault — refusing to overwrite the snapshot with an empty set.",
    );
  }

  const snapshot = buildSnapshot(items);
  await Bun.write(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);

  const totalFields = snapshot.items.reduce(
    (sum, item) => sum + item.fields.length,
    0,
  );
  console.log(
    `Wrote ${SNAPSHOT_PATH}\n  ${String(snapshot.items.length)} items, ${String(totalFields)} field keys (hashed; no values).`,
  );
}

try {
  await main();
} catch (error) {
  die(error instanceof Error ? error.message : String(error));
}
