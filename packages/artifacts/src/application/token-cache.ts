import type { CatalogVersion } from "./content-catalog.ts";

const TTL_MS = 60_000;
const MAX_ENTRIES = 512;

/**
 * Content token to version, kept for 60 seconds and bounded in size so a
 * burst of asset requests does one lookup. Rotating or purging evicts at
 * once, so a rotated token stops resolving immediately in this process.
 */
export function createTokenCache(now: () => number = Date.now) {
  const entries = new Map<string, { value: CatalogVersion; expires: number }>();
  return {
    get(token: string): CatalogVersion | undefined {
      const entry = entries.get(token);
      if (entry === undefined) return undefined;
      if (entry.expires <= now()) {
        entries.delete(token);
        return undefined;
      }
      // Re-insert so the Map's order is recency.
      entries.delete(token);
      entries.set(token, entry);
      return entry.value;
    },
    set(token: string, value: CatalogVersion) {
      entries.delete(token);
      entries.set(token, { value, expires: now() + TTL_MS });
      while (entries.size > MAX_ENTRIES) {
        const oldest = entries.keys().next();
        if (oldest.done === true) break;
        entries.delete(oldest.value);
      }
    },
    invalidateToken(token: string) {
      entries.delete(token);
    },
    invalidateVersion(versionId: string) {
      for (const [token, entry] of entries)
        if (entry.value.versionId === versionId) entries.delete(token);
    },
    size: () => entries.size,
  };
}
export type TokenCache = ReturnType<typeof createTokenCache>;
