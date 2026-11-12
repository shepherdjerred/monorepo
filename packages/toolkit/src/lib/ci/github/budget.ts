/**
 * GitHub budget shared by every toolkit process on one host.
 *
 * All of a user's tokens draw on one 5,000-point GraphQL bucket and one
 * 5,000-request REST bucket per hour. Twenty or thirty `toolkit ci wait` and
 * `toolkit pr land` processes can run at once, so they keep ETagged bodies and
 * the newest observed `x-ratelimit-*` headers in one on-disk store. Processes
 * waiting on the same PR or main reuse each other's recent reads, and all of
 * them slow down together when a bucket runs low.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type {
  CachedResponse,
  ResponseCache,
} from "@shepherdjerred/code-review/github-request";

/** A periodic GitHub read of one PR happens at most this often. */
export const GITHUB_READ_INTERVAL_MS = 60_000;
/** Event-driven GitHub reads (a pipeline transition, a new commit) are at least this far apart. */
export const MIN_GITHUB_GAP_MS = 10_000;
/** Non-final reads accept another process's body this recent without a request. */
export const SHARED_MAX_AGE_MS = 15_000;
/** Non-final reads share the base branch's rules this long. */
export const RULES_MAX_AGE_MS = 5 * 60_000;
/** A memoized review decision is re-asked at least this often. */
export const DECISION_MAX_AGE_MS = 10 * 60_000;
/** Below this fraction of a bucket, periodic reads stop until it resets. */
export const BUDGET_FLOOR = 0.2;
/** Above this fraction, periodic reads run at the base interval. */
const BUDGET_COMFORT = 0.5;
/** Resumes after a reset or refusal are spread across this window. */
export const RESUME_SPREAD_MS = 120_000;
/** Files untouched this long are pruned from the shared store. */
const STORE_TTL_MS = 2 * 24 * 60 * 60_000;
const PRUNE_EVERY_WRITES = 500;

export type KeyValueStore = {
  read: <T>(key: string, schema: z.ZodType<T>) => Promise<T | undefined>;
  write: (key: string, value: unknown) => Promise<void>;
};

/** A bounded in-process store; the default when no shared directory is wanted. */
export class MemoryStore implements KeyValueStore {
  readonly #entries = new Map<string, unknown>();
  constructor(readonly maxEntries = 1000) {}
  read<T>(key: string, schema: z.ZodType<T>): Promise<T | undefined> {
    if (!this.#entries.has(key)) return Promise.resolve(undefined);
    const value = this.#entries.get(key);
    this.#entries.delete(key);
    this.#entries.set(key, value);
    return Promise.resolve(schema.parse(value));
  }
  write(key: string, value: unknown): Promise<void> {
    this.#entries.delete(key);
    this.#entries.set(key, value);
    for (const oldest of this.#entries.keys()) {
      if (this.#entries.size <= this.maxEntries) break;
      this.#entries.delete(oldest);
    }
    return Promise.resolve();
  }
}

const StoredSchema = z.object({ key: z.string(), value: z.unknown() });

/**
 * One JSON file per key. Writers replace a file by atomic rename, so a reader
 * sees a whole old or new value and concurrent writers cost at most a lost
 * update, never a torn file.
 */
export class DiskStore implements KeyValueStore {
  #writes = 0;
  #created = false;
  constructor(
    readonly directory: string,
    readonly now: () => number = Date.now,
  ) {}

  #file(key: string): string {
    const name = createHash("sha256").update(key).digest("hex").slice(0, 40);
    return path.join(this.directory, `${name}.json`);
  }

  async read<T>(key: string, schema: z.ZodType<T>): Promise<T | undefined> {
    const file = Bun.file(this.#file(key));
    let text: string;
    try {
      text = await file.text();
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
    const stored = StoredSchema.parse(JSON.parse(text));
    // A hash collision is not a cache hit.
    return stored.key === key ? schema.parse(stored.value) : undefined;
  }

  async write(key: string, value: unknown): Promise<void> {
    if (!this.#created) {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      this.#created = true;
    }
    const file = this.#file(key);
    const temporary = `${file}.${String(process.pid)}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ key, value }), {
      mode: 0o600,
    });
    await rename(temporary, file);
    if (++this.#writes % PRUNE_EVERY_WRITES === 0) await this.prune();
  }

  /** Remove entries and stray temporaries nobody has touched for two days. */
  async prune(): Promise<void> {
    const cutoff = this.now() - STORE_TTL_MS;
    for (const name of await readdir(this.directory)) {
      const file = path.join(this.directory, name);
      try {
        const { mtimeMs } = await stat(file);
        if (mtimeMs < cutoff) await unlink(file);
      } catch (error) {
        // Another process pruned or replaced it first.
        if (!isMissing(error)) throw error;
      }
    }
  }
}

const MissingFileSchema = z.object({ code: z.literal("ENOENT") });
function isMissing(error: unknown): boolean {
  return MissingFileSchema.safeParse(error).success;
}

/** `$XDG_CACHE_HOME/toolkit/github`, shared by every toolkit process. */
export function githubStateDirectory(
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): string {
  return path.join(
    environment["XDG_CACHE_HOME"] ?? path.join(os.homedir(), ".cache"),
    "toolkit",
    "github",
  );
}

const CachedResponseSchema = z.object({
  etag: z.string(),
  body: z.string(),
  headers: z.array(z.tuple([z.string(), z.string()])),
  storedAt: z.number().optional(),
});

/** ETagged GitHub bodies kept in a {@link KeyValueStore}. */
export class StoreResponseCache implements ResponseCache {
  notModified = 0;
  fetched = 0;
  constructor(readonly store: KeyValueStore) {}
  get(key: string): Promise<CachedResponse | undefined> {
    return this.store.read(`http\n${key}`, CachedResponseSchema);
  }
  set(key: string, entry: CachedResponse): Promise<void> {
    return this.store.write(`http\n${key}`, entry);
  }
}

export type RateLimitBucket = {
  resource: string;
  limit: number;
  remaining: number;
  used: number;
  /** Epoch milliseconds when the bucket refills. */
  resetAt: number;
  observedAt: number;
};
const BucketSchema = z.object({
  resource: z.string(),
  limit: z.number(),
  remaining: z.number(),
  used: z.number(),
  resetAt: z.number(),
  observedAt: z.number(),
});
const LedgerSchema = z.record(z.string(), BucketSchema);

function header(headers: Headers, name: string): number | null {
  const value = headers.get(name);
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The bucket a real GitHub response reports, or null when it carries none. */
export function bucketFromHeaders(
  headers: Headers,
  observedAt: number,
  fallbackResource: string | null = null,
): RateLimitBucket | null {
  const resource = headers.get("x-ratelimit-resource") ?? fallbackResource;
  const limit = header(headers, "x-ratelimit-limit");
  const remaining = header(headers, "x-ratelimit-remaining");
  const reset = header(headers, "x-ratelimit-reset");
  if (
    resource === null ||
    limit === null ||
    remaining === null ||
    reset === null
  )
    return null;
  return {
    resource,
    limit,
    remaining,
    used: header(headers, "x-ratelimit-used") ?? limit - remaining,
    resetAt: reset * 1000,
    observedAt,
  };
}

/**
 * The newest real `x-ratelimit-*` observation per token and resource. Within
 * one reset window the lowest remaining wins, so a slow writer never raises a
 * bucket another process already saw drained.
 */
export class RateLimitLedger {
  static readonly KEY = "rate-limit-ledger";
  constructor(
    readonly store: KeyValueStore,
    readonly now: () => number = Date.now,
  ) {}

  async record(
    identity: string,
    bucket: RateLimitBucket | null,
  ): Promise<void> {
    if (bucket === null) return;
    const ledger =
      (await this.store.read(RateLimitLedger.KEY, LedgerSchema)) ?? {};
    const key = `${identity}:${bucket.resource}`;
    const current = ledger[key];
    const replace =
      current === undefined ||
      bucket.resetAt > current.resetAt ||
      (bucket.resetAt === current.resetAt &&
        bucket.remaining < current.remaining);
    if (!replace) return;
    const expired = this.now() - 60 * 60_000;
    await this.store.write(
      RateLimitLedger.KEY,
      Object.fromEntries(
        [...Object.entries(ledger), [key, bucket] as const].filter(
          ([, entry]) => entry.resetAt >= expired,
        ),
      ),
    );
  }

  /** The current window's observation, or null once that window has reset. */
  async bucket(
    identity: string,
    resource: string,
  ): Promise<RateLimitBucket | null> {
    const ledger =
      (await this.store.read(RateLimitLedger.KEY, LedgerSchema)) ?? {};
    const bucket = ledger[`${identity}:${resource}`];
    return bucket === undefined || bucket.resetAt <= this.now() ? null : bucket;
  }
}

/**
 * When the next periodic (non-final, non-event) GitHub read of a PR may run.
 * Above half a bucket it is the base interval; down to the floor it stretches
 * in proportion; below the floor periodic reads wait for the reset, offset by
 * this process's share of {@link RESUME_SPREAD_MS} so waiters do not resume
 * together. Forced final reads never wait here.
 */
export function nextPeriodicRead(
  lastReadAt: number,
  buckets: readonly (RateLimitBucket | null)[],
  baseMs: number,
  resumeOffset: number,
): number {
  let next = lastReadAt + baseMs;
  for (const bucket of buckets) {
    if (bucket === null || bucket.limit <= 0) continue;
    const fraction = bucket.remaining / bucket.limit;
    if (fraction < BUDGET_FLOOR)
      next = Math.max(next, bucket.resetAt + resumeOffset * RESUME_SPREAD_MS);
    else if (fraction < BUDGET_COMFORT)
      next = Math.max(next, lastReadAt + baseMs * (BUDGET_COMFORT / fraction));
  }
  return next;
}
