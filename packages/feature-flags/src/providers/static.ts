import {
  ErrorCode,
  type EvaluationContext,
  type JsonValue,
  type Provider,
  type ResolutionDetails,
} from "@openfeature/server-sdk";

export type StaticFlagValue = boolean | string | number;

function absent<T>(flagKey: string, defaultValue: T): ResolutionDetails<T> {
  return {
    value: defaultValue,
    reason: "ERROR",
    errorCode: ErrorCode.FLAG_NOT_FOUND,
    errorMessage: `no static override for "${flagKey}"`,
  };
}

function mismatch<T>(
  flagKey: string,
  defaultValue: T,
  actual: string,
  expected: string,
): ResolutionDetails<T> {
  return {
    value: defaultValue,
    reason: "ERROR",
    errorCode: ErrorCode.TYPE_MISMATCH,
    errorMessage: `static override for "${flagKey}" is ${actual}, expected ${expected}`,
  };
}

/**
 * Serves a fixed map of flag values. Used by tests and by local development
 * where reaching a real Flipt is neither possible nor desirable.
 *
 * A key present in the map RESOLVES — including when its value is `false`. A
 * key absent from the map reports `FLAG_NOT_FOUND` so callers fall through.
 * Keeping that distinction here, rather than only in the Flipt provider, is
 * what lets a test exercise the waterfall without a network.
 *
 * A stored value of the wrong type reports `TYPE_MISMATCH` rather than
 * coercing. A string `"false"` silently becoming boolean `true` is exactly the
 * class of bug this package exists to prevent.
 *
 * Each accessor narrows with `typeof` against its own concrete type, which is
 * why there is no shared generic helper here — a generic one cannot narrow
 * `StaticFlagValue` to the caller's `T` without an assertion.
 */
export class StaticProvider implements Provider {
  readonly runsOn = "server";
  readonly metadata = { name: "StaticProvider" } as const;

  private readonly values: ReadonlyMap<string, StaticFlagValue>;

  constructor(values: Readonly<Record<string, StaticFlagValue>>) {
    this.values = new Map(Object.entries(values));
  }

  resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    _context: EvaluationContext,
  ): Promise<ResolutionDetails<boolean>> {
    const stored = this.values.get(flagKey);
    if (stored === undefined) {
      return Promise.resolve(absent(flagKey, defaultValue));
    }
    if (typeof stored !== "boolean") {
      return Promise.resolve(
        mismatch(flagKey, defaultValue, typeof stored, "boolean"),
      );
    }
    return Promise.resolve({ value: stored, reason: "STATIC" });
  }

  resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    _context: EvaluationContext,
  ): Promise<ResolutionDetails<string>> {
    const stored = this.values.get(flagKey);
    if (stored === undefined) {
      return Promise.resolve(absent(flagKey, defaultValue));
    }
    if (typeof stored !== "string") {
      return Promise.resolve(
        mismatch(flagKey, defaultValue, typeof stored, "string"),
      );
    }
    return Promise.resolve({ value: stored, reason: "STATIC" });
  }

  resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
    _context: EvaluationContext,
  ): Promise<ResolutionDetails<number>> {
    const stored = this.values.get(flagKey);
    if (stored === undefined) {
      return Promise.resolve(absent(flagKey, defaultValue));
    }
    if (typeof stored !== "number") {
      return Promise.resolve(
        mismatch(flagKey, defaultValue, typeof stored, "number"),
      );
    }
    return Promise.resolve({ value: stored, reason: "STATIC" });
  }

  resolveObjectEvaluation<T extends JsonValue>(
    flagKey: string,
    defaultValue: T,
    _context: EvaluationContext,
  ): Promise<ResolutionDetails<T>> {
    // Object flags are not supported in v1. Saying so explicitly beats
    // returning the default with a success reason, which would be
    // indistinguishable from a real resolution.
    return Promise.resolve({
      value: defaultValue,
      reason: "ERROR",
      errorCode: ErrorCode.TYPE_MISMATCH,
      errorMessage: `object flags are not supported (requested "${flagKey}")`,
    });
  }
}
