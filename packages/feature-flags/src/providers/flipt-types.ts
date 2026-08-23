/**
 * The Flipt surface this package uses, declared locally instead of imported.
 *
 * ## Why these are not imported from `@flipt-io/flipt-client-js/types`
 *
 * That package ships `"type": "module"` while its `.d.ts` files use
 * extensionless relative specifiers (`export … from './core/types'`). Under
 * `moduleResolution: nodenext` that is invalid ESM: `tsc --noEmit` happens to
 * tolerate it, but typescript-eslint's program resolves those imports to the
 * error type, so every member access on a Flipt type trips
 * `no-unsafe-member-access`. Suppressing the rule would be hiding a real
 * resolution failure.
 *
 * Declaring the shapes here fixes that and is the better boundary regardless:
 * only `flipt-client.ts` touches the vendor module, and it does so at the value
 * level. TypeScript is structural, so the fetcher we hand to `FliptClient.init`
 * still satisfies the parameter it expects.
 *
 * These mirror `dist/types/core/types.d.ts` at v0.5.0. Widening them is safe;
 * narrowing them is what a Flipt upgrade would break, and the fetcher contract
 * test is what catches it.
 */

export type FliptEvaluationRequest = {
  readonly flagKey: string;
  readonly entityId: string;
  readonly context: Record<string, string>;
};

export type FliptBooleanResponse = {
  readonly enabled: boolean;
  readonly flagKey: string;
  readonly reason: string;
};

export type FliptVariantResponse = {
  readonly variantKey: string;
  readonly flagKey: string;
  readonly reason: string;
  readonly match: boolean;
  readonly segmentKeys: readonly string[];
};

export type FliptFlag = {
  readonly key: string;
  readonly enabled: boolean;
  readonly type: string;
};

/** The subset of `Response` the client reads from a fetcher's return value. */
export type FliptHttpResponse = {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly headers: { get: (name: string) => string | null };
  json: () => Promise<unknown>;
};

export type FliptFetcherOptions = {
  readonly etag?: string;
};

export type FliptFetcher = (
  options?: FliptFetcherOptions,
) => Promise<FliptHttpResponse>;
