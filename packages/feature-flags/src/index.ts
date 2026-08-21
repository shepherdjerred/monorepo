import { OpenFeature, type Provider } from "@openfeature/server-sdk";
import {
  FlagErrorCodeSchema,
  FlagReasonSchema,
  type FlagEvaluationOptions,
  type FlagResult,
} from "@shepherdjerred/feature-flags/flag-result.ts";
import { loadFeatureFlagConfiguration } from "@shepherdjerred/feature-flags/config/load.ts";
import { NoopProvider } from "@shepherdjerred/feature-flags/providers/noop.ts";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";
import type { FeatureFlagConfiguration } from "@shepherdjerred/feature-flags/config/schema.ts";
import type { EvaluationEvent } from "@shepherdjerred/feature-flags/observability.ts";

const CLIENT_NAME = "shepherdjerred-feature-flags";

/**
 * Two failure classes, kept strictly apart:
 *
 *   Config error      — malformed URL, unknown mode, missing required variable.
 *                       THROWS from `initFeatureFlags`. This is a deploy bug.
 *   Availability error — backend unreachable, flag not defined, provider not
 *                       ready. NEVER throws. Returns the call-site default
 *                       carrying a reason, so callers can tell "no opinion"
 *                       from "answered false".
 *
 * The carve-out is deliberate and documented in AGENTS.md so review does not
 * re-litigate it on every PR: a flag system that throws on an outage converts a
 * degraded dependency into an outage of its own.
 */

function providerFor(configuration: FeatureFlagConfiguration): Provider {
  switch (configuration.mode) {
    case "disabled":
      return new NoopProvider();
    case "static":
      return new StaticProvider(configuration.overrides);
    case "flipt":
      // The Flipt provider is a separate module so this package stays usable —
      // and testable — without pulling in the WASM engine.
      throw new Error(
        'FEATURE_FLAGS_MODE=flipt requires a provider to be supplied explicitly: initFeatureFlags({ provider: createFliptProvider(config) }). Import it from "@shepherdjerred/feature-flags/providers/flipt.ts".',
      );
  }
}

export type InitFeatureFlagsOptions = {
  /** Overrides the mode-derived provider. Required for `flipt`. */
  readonly provider?: Provider;
  /** Defaults to `Bun.env`. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
  /**
   * Called once if the provider fails to initialize. Injected rather than
   * logged directly so this package needs no logging dependency and each
   * consumer routes it through its own `createLogger`.
   */
  readonly onInitializationFailure?: (message: string) => void;
  /**
   * Called once per evaluation. Injected rather than metered here so this
   * package needs no metrics client — see `observability.ts` for the canonical
   * metric names, and why snapshot age rather than per-evaluation reporting is
   * the outage signal.
   */
  readonly onEvaluation?: (event: EvaluationEvent) => void;
};

let evaluationObserver: ((event: EvaluationEvent) => void) | undefined;

/**
 * Resolves configuration, installs a provider, and waits for it to be ready.
 *
 * A provider that fails to initialize is NOT fatal: OpenFeature leaves it in
 * ERROR and every evaluation then reports `PROVIDER_NOT_READY`, which callers
 * treat as absence. Startup continues so a flag backend outage cannot stop a
 * service from booting.
 */
export async function initFeatureFlags(
  options: InitFeatureFlagsOptions = {},
): Promise<void> {
  const configuration = loadFeatureFlagConfiguration(
    options.environment ?? Bun.env,
  );
  const provider = options.provider ?? providerFor(configuration);
  evaluationObserver = options.onEvaluation;
  try {
    await OpenFeature.setProviderAndWait(CLIENT_NAME, provider);
  } catch (error) {
    // Availability, not configuration. The provider stays in ERROR and
    // evaluations fall back to call-site defaults.
    const message = error instanceof Error ? error.message : String(error);
    options.onInitializationFailure?.(
      `provider "${provider.metadata.name}" failed to initialize; every flag reports PROVIDER_NOT_READY until this pod restarts: ${message}`,
    );
  }
}

function toContext(options: FlagEvaluationOptions<unknown>) {
  return { targetingKey: options.targetingKey, ...options.attributes };
}

function toResult<T>(details: {
  value: T;
  reason?: string | undefined;
  errorCode?: string | undefined;
}): FlagResult<T> {
  // OpenFeature types `reason` and `errorCode` as open strings. Validating them
  // keeps our union honest: an unrecognised value becomes UNKNOWN/GENERAL
  // rather than silently widening the type a caller switches on.
  const reason = FlagReasonSchema.safeParse(details.reason);
  const errorCode =
    details.errorCode === undefined
      ? undefined
      : FlagErrorCodeSchema.safeParse(details.errorCode);
  return {
    value: details.value,
    reason: reason.success ? reason.data : "UNKNOWN",
    errorCode:
      errorCode === undefined
        ? undefined
        : errorCode.success
          ? errorCode.data
          : "GENERAL",
  };
}

export async function isEnabled(
  key: string,
  options: FlagEvaluationOptions<boolean>,
): Promise<FlagResult<boolean>> {
  const details = await OpenFeature.getClient(CLIENT_NAME).getBooleanDetails(
    key,
    options.default,
    toContext(options),
  );
  const result = toResult(details);
  evaluationObserver?.({
    flag: key,
    reason: result.reason,
    errorCode: result.errorCode,
  });
  return result;
}

export async function stringValue(
  key: string,
  options: FlagEvaluationOptions<string>,
): Promise<FlagResult<string>> {
  const details = await OpenFeature.getClient(CLIENT_NAME).getStringDetails(
    key,
    options.default,
    toContext(options),
  );
  const result = toResult(details);
  evaluationObserver?.({
    flag: key,
    reason: result.reason,
    errorCode: result.errorCode,
  });
  return result;
}

export async function numberValue(
  key: string,
  options: FlagEvaluationOptions<number>,
): Promise<FlagResult<number>> {
  const details = await OpenFeature.getClient(CLIENT_NAME).getNumberDetails(
    key,
    options.default,
    toContext(options),
  );
  const result = toResult(details);
  evaluationObserver?.({
    flag: key,
    reason: result.reason,
    errorCode: result.errorCode,
  });
  return result;
}

/**
 * Closes the provider, which stops its refresh timer. Without this `bun test`
 * hangs on the open interval and pods leak a poller across shutdown.
 */
export async function shutdownFeatureFlags(): Promise<void> {
  evaluationObserver = undefined;
  await OpenFeature.close();
}
