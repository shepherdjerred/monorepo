import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

/**
 * Keychain-backed cache for 1Password service-account reads.
 *
 * The whole 1Password account shares one daily read budget, and agents call
 * credentialed tools (kubectl through its exec plugin, talosctl, aws) many
 * times an hour. Each `op://` reference is cached as one generic-password item
 * (service {@link CACHE_SERVICE}, account `sha256(ref)`) holding the value and
 * when it was fetched; entries older than the TTL are read again.
 *
 * The cache lives in the login Keychain, next to the service-account token
 * that already unlocks every one of these values, so it adds no new trust
 * boundary. Items are created through Security.framework (`Bun.secrets`), so
 * values never appear in a process argument list.
 *
 * Keychain ACLs trust the creating binary by its code signature. Only the
 * installed toolkit binary, which `install:local` signs with the operator's
 * Developer ID, uses the cache: an ad-hoc or interpreter-run toolkit would hit
 * an access prompt that blocks unattended agents.
 */

export const CACHE_SERVICE = "toolkit-credential-cache";

/**
 * One day. The account's daily budget (1,000 requests on the current plan) is
 * shared by every host and agent, and the cached values rarely rotate; after a
 * rotation, `toolkit credentials flush NAME` drops the stale entry.
 */
export const DEFAULT_CACHE_TTL_SECONDS = 86_400;

/** Mirrors `installPaths().binary` in scripts/install-core.ts. */
export function installedToolkitPath(): string {
  return path.join(os.homedir(), ".local", "bin", "toolkit");
}

export type CredentialCache = {
  get: (ref: string) => Promise<string | null>;
  set: (ref: string, value: string) => Promise<void>;
  delete: (ref: string) => Promise<boolean>;
};

export type SecretStore = {
  get: (options: { service: string; name: string }) => Promise<string | null>;
  set: (options: {
    service: string;
    name: string;
    value: string;
  }) => Promise<void>;
  delete: (options: { service: string; name: string }) => Promise<boolean>;
};

const CacheEntrySchema = z.strictObject({
  value: z.string().min(1),
  fetchedAt: z.number().int().nonnegative(),
});

function accountFor(ref: string): string {
  return createHash("sha256").update(ref).digest("hex");
}

export function createCredentialCache(options: {
  readonly store: SecretStore;
  readonly ttlSeconds: number;
  readonly now?: () => number;
}): CredentialCache {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlSeconds * 1000;
  return {
    async get(ref) {
      const raw = await options.store.get({
        service: CACHE_SERVICE,
        name: accountFor(ref),
      });
      if (raw === null) return null;
      const parsed = CacheEntrySchema.safeParse(JSON.parse(raw));
      // An entry this cache did not write is a contract break, not a miss.
      if (!parsed.success) {
        throw new Error(
          `toolkit: credential cache entry for ${accountFor(ref).slice(0, 12)}… is malformed; run \`toolkit credentials flush\``,
        );
      }
      const age = now() - parsed.data.fetchedAt;
      return age >= 0 && age < ttlMs ? parsed.data.value : null;
    },
    async set(ref, value) {
      await options.store.set({
        service: CACHE_SERVICE,
        name: accountFor(ref),
        value: JSON.stringify({ value, fetchedAt: now() }),
      });
    },
    async delete(ref) {
      return options.store.delete({
        service: CACHE_SERVICE,
        name: accountFor(ref),
      });
    },
  };
}

/**
 * The live cache, or null when this process must not use it: outside macOS,
 * when the TTL is zero, or when this is not the installed, Developer-ID-signed
 * toolkit binary.
 */
export function liveCredentialCache(
  ttlSeconds: number,
): CredentialCache | null {
  if (process.platform !== "darwin" || ttlSeconds <= 0) return null;
  return process.execPath === installedToolkitPath()
    ? createCredentialCache({ store: Bun.secrets, ttlSeconds })
    : null;
}
