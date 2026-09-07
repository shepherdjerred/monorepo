import {
  ErrorCode,
  type EvaluationContext,
  type JsonValue,
  type Provider,
  type ResolutionDetails,
} from "@openfeature/server-sdk";

/**
 * Resolves nothing. Every evaluation reports `PROVIDER_NOT_READY`, which is the
 * signal `@shepherdjerred/config` uses to fall through to the next layer.
 *
 * That is the point: with `FEATURE_FLAGS_MODE=disabled` a service behaves
 * exactly as it did before flags existed — env, file, and default still decide
 * everything — rather than being forced onto call-site defaults.
 */
export class NoopProvider implements Provider {
  readonly runsOn = "server";
  readonly metadata = { name: "NoopProvider" } as const;

  private absent<T>(defaultValue: T): ResolutionDetails<T> {
    return {
      value: defaultValue,
      reason: "DISABLED",
      errorCode: ErrorCode.PROVIDER_NOT_READY,
      errorMessage: "feature flags are disabled (FEATURE_FLAGS_MODE=disabled)",
    };
  }

  resolveBooleanEvaluation(
    _flagKey: string,
    defaultValue: boolean,
    _context: EvaluationContext,
  ): Promise<ResolutionDetails<boolean>> {
    return Promise.resolve(this.absent(defaultValue));
  }

  resolveStringEvaluation(
    _flagKey: string,
    defaultValue: string,
    _context: EvaluationContext,
  ): Promise<ResolutionDetails<string>> {
    return Promise.resolve(this.absent(defaultValue));
  }

  resolveNumberEvaluation(
    _flagKey: string,
    defaultValue: number,
    _context: EvaluationContext,
  ): Promise<ResolutionDetails<number>> {
    return Promise.resolve(this.absent(defaultValue));
  }

  resolveObjectEvaluation<T extends JsonValue>(
    _flagKey: string,
    defaultValue: T,
    _context: EvaluationContext,
  ): Promise<ResolutionDetails<T>> {
    return Promise.resolve(this.absent(defaultValue));
  }
}
