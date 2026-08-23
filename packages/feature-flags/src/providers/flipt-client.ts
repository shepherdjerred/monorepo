import { z } from "zod";
import type {
  FliptBooleanResponse,
  FliptEvaluationRequest,
  FliptFetcher,
  FliptFlag,
  FliptVariantResponse,
} from "@shepherdjerred/feature-flags/providers/flipt-types.ts";

/**
 * The single boundary against `@flipt-io/flipt-client-js`.
 *
 * ## Why nothing here uses the vendor's types
 *
 * v0.5.0 ships two independent declaration problems:
 *
 * 1. **The `./node` subpath is mis-declared.** Its exports map points `types`
 *    at `dist/types/index.d.ts`, which declares `FliptClient` as the *browser*
 *    implementation, while the runtime file beside it exports the *node* one.
 *    The browser class has no `close()` — and without `close()` the refresh
 *    interval is never cleared, so `bun test` hangs on the open timer and a pod
 *    leaks a poller across shutdown.
 * 2. **The declarations are invalid ESM.** The package is `"type": "module"`
 *    but its `.d.ts` files use extensionless relative specifiers. Under
 *    `moduleResolution: nodenext` that does not resolve: `tsc --noEmit`
 *    tolerates it, but typescript-eslint resolves them to the error type, so
 *    every member access trips `no-unsafe-member-access`.
 *
 * Asserting past either is banned here and would be a lie about a real runtime
 * difference. So this module imports the vendor package **for its values only**
 * and validates everything it gets back. If a future release changes what the
 * node entry point returns, this throws at startup with a specific message
 * instead of silently leaking timers or reporting confident wrong values.
 *
 * Everything else in the package depends on `flipt-types.ts` and this
 * interface, never on the vendor module.
 */
export type FliptEvaluationClient = {
  evaluateBoolean: (request: FliptEvaluationRequest) => FliptBooleanResponse;
  evaluateVariant: (request: FliptEvaluationRequest) => FliptVariantResponse;
  listFlags: () => readonly FliptFlag[];
  close: () => void;
};

export type FliptEvaluationClientOptions = {
  readonly url: string;
  readonly namespace: string;
  readonly environment: string;
  readonly updateInterval: number;
  readonly fetcher: FliptFetcher;
};

/**
 * `ErrorStrategy.Fallback` at v0.5.0. Passing the literal avoids importing the
 * vendor enum's broken declaration; `assertFallbackStrategy` checks the value
 * still matches so an upstream rename fails loudly rather than silently
 * selecting Fail, which would turn a transient refresh error into a mass flag
 * flip.
 */
const ERROR_STRATEGY_FALLBACK = "fallback";

/**
 * Responses arrive as `unknown` because they come back through
 * `Reflect.apply`, so they are validated rather than asserted. Loose about
 * fields we do not read; strict about the one carrying the answer — a missing
 * `enabled` or `variantKey` is a contract break worth failing on, because the
 * provider would otherwise report a confident wrong value.
 */
const BooleanResponseSchema = z.object({
  enabled: z.boolean(),
  flagKey: z.string().default(""),
  reason: z.string().default(""),
});

const VariantResponseSchema = z.object({
  variantKey: z.string(),
  flagKey: z.string().default(""),
  reason: z.string().default(""),
  match: z.boolean().default(false),
  segmentKeys: z.array(z.string()).default([]),
});

const FlagListSchema = z.array(
  z.object({
    key: z.string(),
    enabled: z.boolean().default(false),
    type: z.string().default(""),
  }),
);

type ClientMethod = (...args: readonly unknown[]) => unknown;

function memberOf(source: unknown, name: string, owner: string): unknown {
  // `FliptClient` itself is a class (a function), so both shapes are valid
  // holders of a member here.
  const isReadable =
    source !== null &&
    (typeof source === "object" || typeof source === "function");
  if (!isReadable) {
    throw new TypeError(`${owner} is not an object; cannot read ${name}`);
  }
  return Reflect.get(source, name);
}

function methodOf(source: unknown, name: string, owner: string): ClientMethod {
  // Deliberately not a type-predicate helper: those are banned here, and a
  // predicate would narrow to just this member and discard the rest of the
  // instance. `unknown` plus `typeof` keeps the whole object usable without
  // asserting.
  const candidate = memberOf(source, name, owner);
  if (typeof candidate !== "function") {
    throw new TypeError(
      `${owner} has no callable ${name}(). Check whether @flipt-io/flipt-client-js changed its node entry point.`,
    );
  }
  return (...args: readonly unknown[]): unknown =>
    Reflect.apply(candidate, source, args);
}

function assertFallbackStrategy(vendorModule: unknown): void {
  const strategies = memberOf(vendorModule, "ErrorStrategy", "flipt module");
  const fallback = memberOf(strategies, "Fallback", "ErrorStrategy");
  if (fallback !== ERROR_STRATEGY_FALLBACK) {
    throw new TypeError(
      `@flipt-io/flipt-client-js changed ErrorStrategy.Fallback from "${ERROR_STRATEGY_FALLBACK}" to ${JSON.stringify(fallback)}. Refusing to start: the wrong strategy turns a transient refresh failure into a mass flag flip.`,
    );
  }
}

/**
 * Initializes the real client and returns it behind the verified interface.
 *
 * Every member is looked up and checked, so the returned object provably has
 * what this package calls — including `close()`, which the declared type omits.
 */
export async function createFliptEvaluationClient(
  options: FliptEvaluationClientOptions,
): Promise<FliptEvaluationClient> {
  const vendorModule: unknown = await import("@flipt-io/flipt-client-js/node");
  assertFallbackStrategy(vendorModule);

  const fliptClient = memberOf(vendorModule, "FliptClient", "flipt module");
  const init = methodOf(fliptClient, "init", "FliptClient");

  const client: unknown = await init({
    url: options.url,
    namespace: options.namespace,
    environment: options.environment,
    updateInterval: options.updateInterval,
    // A failed *refresh* keeps the last good snapshot instead of throwing.
    // Reverting to defaults during a transient outage would flip every flag at
    // once — far worse than serving values a few minutes stale.
    errorStrategy: ERROR_STRATEGY_FALLBACK,
    fetcher: options.fetcher,
  });

  const evaluateBoolean = methodOf(client, "evaluateBoolean", "FliptClient");
  const evaluateVariant = methodOf(client, "evaluateVariant", "FliptClient");
  const listFlags = methodOf(client, "listFlags", "FliptClient");
  const close = methodOf(client, "close", "FliptClient");

  return {
    evaluateBoolean: (request) =>
      BooleanResponseSchema.parse(evaluateBoolean(request)),
    evaluateVariant: (request) =>
      VariantResponseSchema.parse(evaluateVariant(request)),
    listFlags: () => FlagListSchema.parse(listFlags()),
    close: () => {
      close();
    },
  };
}
