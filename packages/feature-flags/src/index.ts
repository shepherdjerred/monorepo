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
import { FliptProvider } from "@shepherdjerred/feature-flags/providers/flipt.ts";
import type { FeatureFlagConfiguration } from "@shepherdjerred/feature-flags/config/schema.ts";
import type {
  EvaluationEvent,
  FlagMetricsRecorder,
} from "@shepherdjerred/feature-flags/observability.ts";

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

function providerFor(
  configuration: FeatureFlagConfiguration,
  metrics: FlagMetricsRecorder | undefined,
): Provider {
  switch (configuration.mode) {
    case "disabled":
      return new NoopProvider();
    case "static":
      return new StaticProvider(configuration.overrides);
    case "flipt":
      return new FliptProvider({
        url: configuration.url,
        namespace: configuration.namespace,
        environment: configuration.environment,
        pollIntervalSeconds: configuration.pollIntervalSeconds,
        onRefreshFailure: () => metrics?.countError("refresh"),
        onSnapshotAge: (seconds) => metrics?.observeSnapshotAge(seconds),
      });
  }
}

export type InitFeatureFlagsOptions = {
  /** Overrides the mode-derived provider for one initialization attempt. */
  readonly provider?: Provider;
  /**
   * Creates a fresh provider for every initialization attempt. Production uses
   * the mode-derived factory; tests may inject one to exercise recovery.
   */
  readonly providerFactory?: () => Provider;
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
  /** Optional process-owned Prometheus hooks for the provider lifecycle. */
  readonly metrics?: FlagMetricsRecorder;
};

let evaluationObserver: ((event: EvaluationEvent) => void) | undefined;
let metricsRecorder: FlagMetricsRecorder | undefined;
let retryController: AbortController | undefined;
let retryTask: Promise<void> | undefined;

const RETRY_DELAYS_SECONDS = [1, 2, 4, 8, 16, 30] as const;
const PROVIDER_INITIALIZATION_TIMEOUT_MS = 10_000;

class ProviderInitializationBoundaryError extends Error {}
class ProviderInitializationAbortedError extends ProviderInitializationBoundaryError {}
class ProviderInitializationTimedOutError extends ProviderInitializationBoundaryError {}

function retryDelayMilliseconds(attempt: number): number {
  const index = Math.min(attempt, RETRY_DELAYS_SECONDS.length - 1);
  const seconds = RETRY_DELAYS_SECONDS[index];
  if (seconds === undefined) {
    throw new Error("Feature flag retry delay table is empty");
  }
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.round(seconds * jitter * 1000);
}

async function waitForRetry(
  milliseconds: number,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return false;
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timeout = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
  return !signal.aborted;
}

async function initializeProvider(
  provider: Provider,
  signal?: AbortSignal,
): Promise<void> {
  const initialization = OpenFeature.setProviderAndWait(CLIENT_NAME, provider);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rejectBoundary: ((reason: Error) => void) | undefined;
  const onAbort = () => {
    rejectBoundary?.(new ProviderInitializationAbortedError());
  };
  const boundary = new Promise<never>((_resolve, reject) => {
    rejectBoundary = reject;
    if (signal?.aborted === true) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    timeout = setTimeout(() => {
      reject(
        new ProviderInitializationTimedOutError(
          `Feature flag provider initialization timed out after ${String(PROVIDER_INITIALIZATION_TIMEOUT_MS)}ms`,
        ),
      );
    }, PROVIDER_INITIALIZATION_TIMEOUT_MS);
  });

  try {
    await Promise.race([initialization, boundary]);
  } catch (error) {
    if (error instanceof ProviderInitializationTimedOutError) {
      // Unbind the timed-out wrapper before it can complete late and publish a
      // stale READY transition. Installing the no-op preserves normal
      // lower-layer fallback while the next fresh provider waits to retry.
      try {
        OpenFeature.setProvider(CLIENT_NAME, new NoopProvider());
      } catch {
        requestProviderClose(provider);
      }
      void closeProviderAfterInitialization(initialization, provider);
    }
    throw error;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function closeProviderAfterInitialization(
  initialization: Promise<void>,
  provider: Provider,
): Promise<void> {
  try {
    await initialization;
  } catch {
    requestProviderClose(provider);
    return;
  }
  requestProviderClose(provider);
}

function requestProviderClose(provider: Provider): void {
  try {
    void Promise.resolve(provider.onClose?.()).catch(() => false);
  } catch {
    return;
  }
}

async function retryProviderInitialization(
  providerFactory: () => Provider,
  metrics: FlagMetricsRecorder | undefined,
  signal: AbortSignal,
): Promise<void> {
  let attempt = 0;
  while (!signal.aborted) {
    const shouldRetry = await waitForRetry(
      retryDelayMilliseconds(attempt),
      signal,
    );
    if (!shouldRetry) return;
    try {
      await initializeProvider(providerFactory(), signal);
      metrics?.observeProviderReady(true);
      return;
    } catch (error) {
      if (error instanceof ProviderInitializationAbortedError) return;
      metrics?.observeProviderReady(false);
      metrics?.countError("initialize");
      attempt++;
    }
  }
}

async function stopProviderRetry(): Promise<void> {
  const controller = retryController;
  const task = retryTask;
  retryController = undefined;
  retryTask = undefined;
  controller?.abort();
  await task;
}

function startProviderRetry(
  providerFactory: (() => Provider) | undefined,
  metrics: FlagMetricsRecorder | undefined,
): void {
  if (providerFactory === undefined) return;
  const controller = new AbortController();
  retryController = controller;
  retryTask = retryProviderInitialization(
    providerFactory,
    metrics,
    controller.signal,
  );
}

/**
 * Resolves configuration, installs a provider, and waits for it to be ready.
 *
 * A provider that fails to initialize is NOT fatal: OpenFeature leaves it in
 * ERROR and every evaluation then reports `PROVIDER_NOT_READY`, which callers
 * treat as absence. Startup continues and mode-derived providers retry with
 * bounded backoff, so a flag backend outage cannot stop a service from booting
 * or require a pod restart to recover.
 */
export async function initFeatureFlags(
  options: InitFeatureFlagsOptions = {},
): Promise<void> {
  if (options.provider !== undefined && options.providerFactory !== undefined) {
    throw new Error("provider and providerFactory are mutually exclusive");
  }
  await stopProviderRetry();
  const configuration = loadFeatureFlagConfiguration(
    options.environment ?? Bun.env,
  );
  const providerFactory =
    options.providerFactory ??
    (options.provider === undefined
      ? () => providerFor(configuration, options.metrics)
      : undefined);
  const provider = options.provider ?? providerFactory?.();
  if (provider === undefined) {
    throw new Error("Feature flag provider factory returned no provider");
  }
  evaluationObserver = options.onEvaluation;
  metricsRecorder = options.metrics;
  options.metrics?.observeProviderReady(false);
  try {
    await initializeProvider(provider);
    options.metrics?.observeProviderReady(true);
  } catch (error) {
    // Availability, not configuration. The provider remains unavailable and
    // evaluations fall back to call-site defaults.
    const message = error instanceof Error ? error.message : String(error);
    options.onInitializationFailure?.(
      `provider "${provider.metadata.name}" failed to initialize; every flag reports PROVIDER_NOT_READY${providerFactory === undefined ? "" : " while initialization retries in the background"}: ${message}`,
    );
    options.metrics?.observeProviderReady(false);
    options.metrics?.countError("initialize");
    startProviderRetry(providerFactory, options.metrics);
  }
}

function recordEvaluation(event: EvaluationEvent): void {
  evaluationObserver?.(event);
  metricsRecorder?.countEvaluation(event);
  if (
    event.errorCode !== undefined &&
    event.errorCode !== "FLAG_NOT_FOUND" &&
    event.errorCode !== "PROVIDER_NOT_READY"
  ) {
    metricsRecorder?.countError("evaluate");
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
  recordEvaluation({
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
  recordEvaluation({
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
  recordEvaluation({
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
  await stopProviderRetry();
  metricsRecorder?.observeProviderReady(false);
  evaluationObserver = undefined;
  metricsRecorder = undefined;
  await OpenFeature.close();
}
