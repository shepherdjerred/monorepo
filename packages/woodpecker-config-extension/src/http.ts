/**
 * The part of `fetch` this service actually uses.
 *
 * Deliberately narrower than `typeof fetch`: the global type carries
 * runtime-specific members (Bun adds `preconnect`) that a test double has no
 * reason to implement, and depending on them would make every injected fetch
 * a structural mismatch.
 */
export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
