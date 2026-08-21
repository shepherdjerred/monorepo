import type {
  FliptFetcher,
  FliptFetcherOptions,
  FliptHttpResponse,
} from "@shepherdjerred/feature-flags/providers/flipt-types.ts";

export type FakeFetcherBehavior =
  | {
      readonly kind: "snapshot";
      readonly body: unknown;
      readonly etag?: string;
    }
  | { readonly kind: "not-modified"; readonly etag: string }
  | { readonly kind: "http-error"; readonly status: number }
  | { readonly kind: "network-error"; readonly message: string };

export type FakeFetcher = {
  readonly fetcher: FliptFetcher;
  /** Queue the behavior for the next call. Repeats until replaced. */
  setBehavior: (behavior: FakeFetcherBehavior) => void;
  /** Every `etag` the client sent, in order. */
  readonly sentEtags: readonly (string | undefined)[];
  readonly callCount: () => number;
};

function response(
  status: number,
  body: unknown,
  etag: string | undefined,
): FliptHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 304 ? "Not Modified" : "OK",
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "etag" ? (etag ?? null) : null,
    },
    json: () => Promise.resolve(body),
  };
}

/**
 * An `IFetcher` serving a fixture instead of a network.
 *
 * This drives the **real** WASM evaluation engine, so bucketing, rollouts, and
 * rule matching are genuinely exercised — the only thing replaced is the
 * transport. A hand-rolled fake evaluator would test our idea of Flipt's
 * semantics rather than Flipt's.
 */
export function createFakeFetcher(initial: FakeFetcherBehavior): FakeFetcher {
  let behavior = initial;
  const etags: (string | undefined)[] = [];

  const fetcher: FliptFetcher = (options?: FliptFetcherOptions) => {
    etags.push(options?.etag);
    switch (behavior.kind) {
      case "snapshot":
        return Promise.resolve(response(200, behavior.body, behavior.etag));
      case "not-modified":
        return Promise.resolve(response(304, undefined, behavior.etag));
      case "http-error":
        return Promise.reject(
          new Error(
            `flipt snapshot request failed: ${behavior.status.toString()}`,
          ),
        );
      case "network-error":
        return Promise.reject(new Error(behavior.message));
    }
  };

  return {
    fetcher,
    setBehavior: (next: FakeFetcherBehavior) => {
      behavior = next;
    },
    sentEtags: etags,
    callCount: () => etags.length,
  };
}
