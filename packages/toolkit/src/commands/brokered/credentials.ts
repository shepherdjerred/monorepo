import { liveCredentialCache } from "#lib/credential-cache.ts";
import type { CredentialCache } from "#lib/credential-cache.ts";
import {
  credentialReferences,
  flushCredentialCache,
} from "#lib/credential-overrides.ts";
import { loadToolkitConfig } from "#lib/toolkit-config.ts";

/**
 * `toolkit credentials flush [NAME…]`: drop cached 1Password reads after a
 * rotation so the next use fetches the new value.
 */

const USAGE = "Usage: toolkit credentials flush [NAME...] | references --json";

async function activeCache(): Promise<CredentialCache | null> {
  const config = await loadToolkitConfig();
  const ttl = await config.get("credentialCacheTtlSeconds");
  return liveCredentialCache(ttl.value);
}

export async function runCredentialsCommand(
  args: readonly string[],
  cache?: CredentialCache | null,
): Promise<number> {
  const [action, ...names] = args;
  if (action === "references" && names.length === 1 && names[0] === "--json") {
    console.log(JSON.stringify(await credentialReferences()));
    return 0;
  }
  if (action !== "flush") {
    console.error(USAGE);
    return 2;
  }
  const target = cache === undefined ? await activeCache() : cache;
  if (target === null) {
    console.error(
      "toolkit: the credential cache is not active for this binary (only the installed, signed toolkit on macOS uses it); nothing to flush.",
    );
    return 0;
  }
  const flushed = await flushCredentialCache(names, { cache: target });
  console.error(
    flushed.length === 0
      ? "toolkit: no cached credentials to flush"
      : `toolkit: flushed ${flushed.join(", ")}`,
  );
  return 0;
}
