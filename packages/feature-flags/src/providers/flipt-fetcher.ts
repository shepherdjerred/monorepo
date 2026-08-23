import type {
  FliptFetcher,
  FliptFetcherOptions,
  FliptHttpResponse,
} from "@shepherdjerred/feature-flags/providers/flipt-types.ts";

export type FliptFetcherTarget = {
  readonly url: string;
  readonly namespace: string;
  readonly environment: string;
};

/**
 * The Accept-version header the upstream client sends. It is the evaluation
 * API contract version, not the Flipt release, and it is pinned here for the
 * same reason the image digest is pinned in the version catalog: this request
 * shape and the committed snapshot fixture have to agree.
 */
const ACCEPT_SERVER_VERSION = "1.47.0";

/**
 * Builds the snapshot fetcher instead of letting the client construct its own.
 *
 * Two reasons. The client's built-in fetcher `await import("node-fetch")`s on
 * first use; supplying our own keeps this on Bun's native fetch and drops the
 * dependency from the runtime path entirely. And it means production and tests
 * traverse the same code — the test suite swaps only the transport underneath.
 *
 * This mirrors the upstream request exactly (`dist/node/index.mjs`). A unit test
 * pins the URL and header set, because this duplication is the most likely
 * thing to drift silently on a Flipt upgrade.
 */
export function createFliptFetcher(options: FliptFetcherTarget): FliptFetcher {
  const base = options.url.replace(/\/$/, "");
  const url = `${base}/internal/v1/evaluation/snapshot/namespace/${options.namespace}`;

  return async (
    fetcherOptions?: FliptFetcherOptions,
  ): Promise<FliptHttpResponse> => {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "x-flipt-accept-server-version": ACCEPT_SERVER_VERSION,
      "x-flipt-environment": options.environment,
    };
    if (fetcherOptions?.etag !== undefined) {
      headers["If-None-Match"] = fetcherOptions.etag;
    }

    const response = await fetch(url, { method: "GET", headers });

    // 304 is a successful "nothing changed" and must be handed back rather
    // than thrown: the client uses it to keep the snapshot it already has.
    if (!response.ok && response.status !== 304) {
      throw new Error(
        `flipt snapshot request failed: ${response.status.toString()} ${response.statusText}`,
      );
    }
    return response;
  };
}
