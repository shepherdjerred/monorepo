import configuration from "#src/configuration.ts";

/**
 * Body of GET /api/version — the deploy identity of this backend process.
 *
 * `version`/`gitSha` label the build that produced the image (the backend is
 * content-gated, so this legitimately lags the site's build number in a
 * healthy release pair). `contractHash` fingerprints the tRPC contract
 * sources (packages/scout-for-lol/scripts/contract-hash.ts); the SPA
 * compares it against its own baked hash and nudges a reload on mismatch —
 * version equality is NOT the compatibility signal, the hash is.
 */
export function versionBody(): {
  version: string;
  gitSha: string;
  contractHash: string;
} {
  return {
    version: configuration.version,
    gitSha: configuration.gitSha,
    contractHash: configuration.contractHash,
  };
}

/**
 * Handler for GET /api/version. Unauthenticated by design (it exposes only
 * build metadata) and `no-store` so open tabs always see the live backend,
 * not a cached identity. `corsHeaders` comes from the server's
 * `corsHeadersFor(request)` so the SPA origin can read it cross-origin in
 * dev.
 */
export function handleVersion(corsHeaders: Record<string, string>): Response {
  return Response.json(versionBody(), {
    headers: { "Cache-Control": "no-store", ...corsHeaders },
  });
}
