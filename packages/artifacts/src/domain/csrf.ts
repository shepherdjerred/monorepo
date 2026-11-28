export type CsrfRejection =
  "cross-site" | "origin-mismatch" | "missing-origin" | "navigation-only";

export type CsrfInput = {
  method: string;
  appOrigin: string;
  origin: string | null;
  fetchSite: string | null;
  fetchMode: string | null;
  fetchDest: string | null;
};

const SAFE_METHODS = new Set(["GET", "HEAD"]);

/**
 * The app host's CSRF rule. Tailscale identity is ambient, so any page the
 * operator visits could otherwise make their browser call the service:
 *
 * - `Sec-Fetch-Site`, when present, must be `same-origin`; `none` (typed URL,
 *   bookmark) is allowed only for a top-level document GET.
 * - `Origin`, when present, must be the app origin. `null` never matches.
 * - A state-changing request needs a matching `Origin`, or neither `Origin`
 *   nor `Sec-Fetch-Site` at all (the CLI, which is not a browser).
 *
 * Returns the reason a request is rejected, or null when it may proceed.
 */
export function checkCsrf(input: CsrfInput): CsrfRejection | null {
  const method = input.method.toUpperCase();
  const safe = SAFE_METHODS.has(method);
  if (input.fetchSite !== null && input.fetchSite !== "same-origin") {
    const navigation =
      input.fetchSite === "none" &&
      method === "GET" &&
      input.fetchMode === "navigate" &&
      input.fetchDest === "document";
    if (!navigation)
      return input.fetchSite === "none" ? "navigation-only" : "cross-site";
  }
  if (input.origin !== null && input.origin !== input.appOrigin)
    return "origin-mismatch";
  return !safe && input.origin === null && input.fetchSite !== null
    ? "missing-origin"
    : null;
}

/** A request from a browser always carries `Sec-Fetch-Site`; the CLI never does. */
export function isBrowserRequest(fetchSite: string | null): boolean {
  return fetchSite !== null;
}
