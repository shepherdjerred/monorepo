import { CLIENT_REQUEST_ID_HEADER } from "#shared/contract.ts";

/**
 * The request IDs this tab issued recently. The stream names the request
 * behind each change, so a change this tab made itself is recognised and
 * skipped even when it arrives before the mutation's response.
 */
export function createRequestIds(options: {
  /** How many IDs to remember; the oldest go first. */
  limit: number;
  /** How long an ID is remembered. */
  ttlMs: number;
  now?: () => number;
  uuid?: () => string;
}) {
  const now = options.now ?? Date.now;
  const uuid = options.uuid ?? (() => crypto.randomUUID());
  // Insertion order is issue order, so the oldest IDs come first.
  const issued = new Map<string, number>();
  function prune(at: number) {
    for (const [id, issuedAt] of issued) {
      if (issued.size <= options.limit && at - issuedAt < options.ttlMs) {
        return;
      }
      issued.delete(id);
    }
  }
  return {
    /** A fresh ID for one HTTP request, remembered as this tab's own. */
    next() {
      const id = uuid();
      const at = now();
      issued.set(id, at);
      prune(at);
      return id;
    },
    /** Whether this tab issued `id` recently. */
    has(id: string) {
      prune(now());
      return issued.has(id);
    },
  };
}

export const ownRequests = createRequestIds({
  limit: 500,
  ttlMs: 5 * 60_000,
});

/** The header that names one outgoing request as this tab's. */
export function requestIdHeader() {
  return { [CLIENT_REQUEST_ID_HEADER]: ownRequests.next() };
}
