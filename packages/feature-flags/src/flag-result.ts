import { z } from "zod";

/**
 * The shape every evaluation returns, and the vocabulary
 * `@shepherdjerred/config` uses to decide whether a flag answered or simply is
 * not there.
 *
 * That distinction is the whole contract. A flag that exists and evaluates to
 * `false` IS the answer and must stop the waterfall; a flag that does not exist
 * must fall through to the next source. Collapsing the two re-enables things an
 * operator just turned off.
 *
 * Both vocabularies are Zod schemas with the types inferred from them, so the
 * runtime narrowing and the compile-time union cannot drift apart. They mirror
 * OpenFeature's `StandardResolutionReasons` and `ErrorCode`.
 */

export const FlagReasonSchema = z.enum([
  "STATIC",
  "DEFAULT",
  "TARGETING_MATCH",
  "SPLIT",
  "CACHED",
  "DISABLED",
  "STALE",
  "UNKNOWN",
  "ERROR",
]);

export type FlagReason = z.infer<typeof FlagReasonSchema>;

export const FlagErrorCodeSchema = z.enum([
  "PROVIDER_NOT_READY",
  "PROVIDER_FATAL",
  "FLAG_NOT_FOUND",
  "PARSE_ERROR",
  "TYPE_MISMATCH",
  "TARGETING_KEY_MISSING",
  "INVALID_CONTEXT",
  "GENERAL",
]);

export type FlagErrorCode = z.infer<typeof FlagErrorCodeSchema>;

export type FlagResult<T> = {
  readonly value: T;
  readonly reason: FlagReason;
  readonly errorCode: FlagErrorCode | undefined;
};

/**
 * Attribute values a caller may attach to an evaluation. Scalars only: Flipt's
 * evaluation context is `Record<string, string>`, and silently stringifying an
 * object would produce targeting rules that match on "[object Object]".
 */
export type FlagAttributes = Readonly<
  Record<string, string | number | boolean>
>;

export type FlagEvaluationOptions<T> = {
  /**
   * Required, per the OpenFeature spec. This must be current production
   * behavior: it is what a cold start and a provider outage both resolve to.
   */
  readonly default: T;
  /** Flipt's `entityId`. Required — it is the bucketing key for ramp-ups. */
  readonly targetingKey: string;
  readonly attributes?: FlagAttributes;
};

/**
 * Error codes that mean "this source has no opinion", as opposed to "this
 * source answered".  Only these may fall through to a lower config layer.
 *
 * `FLAG_NOT_FOUND` — the key is not defined in the backend.
 * `PROVIDER_NOT_READY` — the provider never initialized, so it cannot know.
 *
 * Everything else, including `GENERAL` and `PARSE_ERROR`, means the source
 * tried and failed. Those must NOT fall through: a backend erroring on a flag
 * it does own is not the same as that flag being absent, and treating it as
 * absent would silently hand control to a stale env var.
 */
export function isAbsent(result: FlagResult<unknown>): boolean {
  return (
    result.errorCode === "FLAG_NOT_FOUND" ||
    result.errorCode === "PROVIDER_NOT_READY"
  );
}
