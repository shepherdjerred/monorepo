import type { FliptFetcher } from "@shepherdjerred/feature-flags/providers/flipt-types.ts";
import {
  ErrorCode,
  type EvaluationContext,
  type JsonValue,
  type Provider,
  type ResolutionDetails,
} from "@openfeature/server-sdk";
import { createFliptFetcher } from "@shepherdjerred/feature-flags/providers/flipt-fetcher.ts";
import {
  createFliptEvaluationClient,
  type FliptEvaluationClient,
} from "@shepherdjerred/feature-flags/providers/flipt-client.ts";
import { toFliptInputs } from "@shepherdjerred/feature-flags/providers/flipt-context.ts";

class SnapshotUnavailableError extends Error {}

async function fetchSnapshot(
  source: FliptFetcher,
  options: Parameters<FliptFetcher>[0],
  signal: AbortSignal,
) {
  signal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  if (signal.aborted)
    throw new SnapshotUnavailableError("Snapshot request aborted");
  let abort: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => {
      reject(new SnapshotUnavailableError("Snapshot request aborted"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([source(options), cancelled]);
  } catch (error) {
    throw new SnapshotUnavailableError("Snapshot transport unavailable", {
      cause: error,
    });
  } finally {
    if (abort !== undefined) signal.removeEventListener("abort", abort);
  }
}

async function settleRefresh(
  task: Promise<unknown> | undefined,
): Promise<void> {
  try {
    await task;
  } catch {
    // The refresh owner records the failure; later requests can still recover.
  }
}

async function observeCompletion(
  task: Promise<unknown>,
  cleanup: () => void,
): Promise<void> {
  try {
    await settleRefresh(task);
  } finally {
    cleanup();
  }
}

export type FliptProviderOptions = {
  readonly url: string;
  readonly namespace: string;
  readonly environment: string;
  readonly pollIntervalSeconds: number;
  /** Injected by tests to drive the real WASM engine without a network. */
  readonly fetcher?: FliptFetcher;
  /** Called when a refresh cannot obtain a successful snapshot. */
  readonly onRefreshFailure?: () => void;
  /** Receives the current successful-snapshot age for the process registry. */
  readonly onSnapshotAge?: (seconds: number) => void;
};

function absent<T>(flagKey: string, defaultValue: T): ResolutionDetails<T> {
  return {
    value: defaultValue,
    reason: "ERROR",
    errorCode: ErrorCode.FLAG_NOT_FOUND,
    errorMessage: `flag "${flagKey}" is not defined in this Flipt namespace`,
  };
}

function notReady<T>(defaultValue: T): ResolutionDetails<T> {
  return {
    value: defaultValue,
    reason: "ERROR",
    errorCode: ErrorCode.PROVIDER_NOT_READY,
    errorMessage: "flipt provider has not initialized",
  };
}

/**
 * OpenFeature provider backed by Flipt's in-process WASM evaluation engine.
 *
 * Evaluation is a local computation against a snapshot the client refreshes in
 * the background, so the async OpenFeature surface costs nothing here.
 *
 * ## Why `listFlags()` decides absence
 *
 * Verified against flipt/flipt:v2.13.0, not assumed from docs:
 *
 * - `evaluateBoolean` on an unknown key **throws**. It does not return a
 *   not-found reason.
 * - `reason` is `DEFAULT_EVALUATION_REASON` for a `true`, a `false`, and a
 *   rollout miss alike, so it discriminates nothing.
 *
 * That leaves `listFlags()` — synchronous, reading the same cached snapshot —
 * as the only reliable absence signal that does not involve matching on an
 * error message string.
 *
 * The distinction is load-bearing for `@shepherdjerred/config`: a key the
 * snapshot does not contain is `FLAG_NOT_FOUND` and falls through to the next
 * layer, while a throw on a key it *does* contain is `GENERAL` and must not.
 * Collapsing the two would hand control to a stale env var whenever the engine
 * hiccuped on a flag Flipt genuinely owns.
 */
export class FliptProvider implements Provider {
  readonly runsOn = "server";
  readonly metadata = { name: "FliptProvider" } as const;

  private readonly options: FliptProviderOptions;
  private client: FliptEvaluationClient | undefined;
  private knownKeys: ReadonlySet<string> = new Set();
  private lastSuccessfulRefreshMs: number | undefined;
  private snapshotAgeTimer: ReturnType<typeof setInterval> | undefined;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private readonly controller = new AbortController();
  private refreshTask: Promise<void> | undefined;
  private freshSnapshot: Promise<boolean> | undefined;
  private forceFullSnapshot = false;
  private closed = false;

  constructor(options: FliptProviderOptions) {
    this.options = options;
  }

  async initialize(): Promise<void> {
    if (this.closed || this.client !== undefined) {
      throw new Error("Flipt provider already initialized or closed");
    }
    const sourceFetcher =
      this.options.fetcher ??
      createFliptFetcher({
        url: this.options.url,
        namespace: this.options.namespace,
        environment: this.options.environment,
        signal: this.controller.signal,
        requestTimeoutMilliseconds: 10_000,
      });
    const fetcher: FliptFetcher = async (fetchOptions) => {
      const response = await fetchSnapshot(
        sourceFetcher,
        this.forceFullSnapshot ? undefined : fetchOptions,
        this.controller.signal,
      );
      if (!response.ok && response.status !== 304)
        throw new SnapshotUnavailableError("Snapshot HTTP request unavailable");
      if (this.forceFullSnapshot && response.status === 304)
        throw new Error("Unconditional snapshot request returned 304");
      // refresh() stores ETags before validating the body. A strict refresh must
      // read the complete body even after an earlier invalid response poisoned
      // the SDK's ETag. This uses the existing transport, without a second client.
      return this.forceFullSnapshot
        ? {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers: {
              get: (name) =>
                name.toLowerCase() === "etag"
                  ? null
                  : response.headers.get(name),
            },
            json: () => response.json(),
          }
        : response;
    };
    try {
      const client = await createFliptEvaluationClient({
        url: this.options.url,
        namespace: this.options.namespace,
        environment: this.options.environment,
        // Serialize polling and explicit refresh through the provider.
        updateInterval: 0,
        fetcher,
      });
      try {
        this.controller.signal.throwIfAborted();
        client.listFlags();
      } catch (error) {
        client.close();
        throw error;
      }
      this.client = client;
      this.recordSuccessfulRefresh();
      if (this.options.pollIntervalSeconds > 0) {
        this.refreshTimer = setInterval(() => {
          if (this.refreshTask === undefined) {
            void this.enqueueRefresh(false);
          }
        }, this.options.pollIntervalSeconds * 1000);
      }
      if (this.options.onSnapshotAge !== undefined) {
        this.snapshotAgeTimer = setInterval(
          () => {
            this.updateSnapshotAge();
          },
          Math.min(
            60_000,
            Math.max(1000, this.options.pollIntervalSeconds * 1000),
          ),
        );
      }
    } catch (error) {
      this.options.onRefreshFailure?.();
      throw error;
    }
  }

  private recordSuccessfulRefresh(): void {
    this.refreshKnownKeys();
    this.lastSuccessfulRefreshMs = Date.now();
    this.updateSnapshotAge();
  }

  private enqueueRefresh(requireFresh: boolean): Promise<void> {
    const refresh = this.performRefresh(requireFresh, this.refreshTask);
    this.refreshTask = refresh;
    void observeCompletion(refresh, () => {
      if (this.refreshTask === refresh) this.refreshTask = undefined;
    });
    return refresh;
  }

  private isClosed(): boolean {
    return this.closed;
  }

  private async performRefresh(
    requireFresh: boolean,
    preceding: Promise<void> | undefined,
  ): Promise<void> {
    await settleRefresh(preceding);
    const client = this.client;
    if (client === undefined || this.isClosed())
      throw new SnapshotUnavailableError("Flipt provider is unavailable");
    this.forceFullSnapshot = requireFresh;
    try {
      await client.refresh();
      if (this.isClosed())
        throw new SnapshotUnavailableError(
          "Flipt provider closed during refresh",
        );
      this.recordSuccessfulRefresh();
    } catch (error) {
      if (!this.isClosed()) this.options.onRefreshFailure?.();
      throw error;
    } finally {
      this.forceFullSnapshot = false;
    }
  }

  /** Requires a validated full snapshot; ordinary reads still use the last good one. */
  refreshForEvaluation(): Promise<boolean> {
    if (this.closed || this.client === undefined) return Promise.resolve(false);
    if (this.freshSnapshot !== undefined) return this.freshSnapshot;
    const refresh = this.requireFreshSnapshot();
    this.freshSnapshot = refresh;
    void observeCompletion(refresh, () => {
      if (this.freshSnapshot === refresh) this.freshSnapshot = undefined;
    });
    return refresh;
  }

  private async requireFreshSnapshot(): Promise<boolean> {
    try {
      await this.enqueueRefresh(true);
      return true;
    } catch (error) {
      if (error instanceof SnapshotUnavailableError) return false;
      throw error;
    }
  }

  onClose(): Promise<void> {
    this.closed = true;
    this.controller.abort();
    if (this.refreshTimer !== undefined) clearInterval(this.refreshTimer);
    if (this.snapshotAgeTimer !== undefined)
      clearInterval(this.snapshotAgeTimer);
    this.refreshTimer = undefined;
    this.snapshotAgeTimer = undefined;
    this.client?.close();
    this.client = undefined;
    this.knownKeys = new Set();
    this.lastSuccessfulRefreshMs = undefined;
    // Wait until an in-flight SDK refresh observes the abort before shutdown
    // completes; no refresh can publish another engine or start a new timer.
    return settleRefresh(this.refreshTask);
  }

  /**
   * Re-reads the key set from the current snapshot. Called after init and after
   * any evaluation that finds a key missing, so a flag created in the UI starts
   * resolving on the next poll rather than needing a restart.
   */
  private refreshKnownKeys(): void {
    if (this.client === undefined) {
      return;
    }
    this.knownKeys = new Set(this.client.listFlags().map((flag) => flag.key));
  }

  private updateSnapshotAge(): void {
    const age = this.snapshotAgeSeconds();
    if (age !== undefined) {
      this.options.onSnapshotAge?.(age);
    }
  }

  /**
   * Seconds since the snapshot was last fetched successfully, or `undefined`
   * before the first successful initialize.
   *
   * This is the outage signal. During a backend outage the client keeps serving
   * its last good snapshot, so evaluations still succeed and nothing looks
   * wrong; a rising age is what tells an operator the values are frozen. See
   * `observability.ts` for why this replaces per-evaluation reporting.
   */
  snapshotAgeSeconds(): number | undefined {
    return this.lastSuccessfulRefreshMs === undefined
      ? undefined
      : (Date.now() - this.lastSuccessfulRefreshMs) / 1000;
  }

  private evaluate<T>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext,
    run: (
      client: FliptEvaluationClient,
      entityId: string,
      ctx: Record<string, string>,
    ) => T,
  ): ResolutionDetails<T> {
    const client = this.client;
    if (client === undefined) {
      return notReady(defaultValue);
    }

    const inputs = toFliptInputs(context);
    if (inputs === undefined) {
      return {
        value: defaultValue,
        reason: "ERROR",
        errorCode: ErrorCode.TARGETING_KEY_MISSING,
        errorMessage: `evaluating "${flagKey}" requires a non-empty targetingKey`,
      };
    }

    // Reconcile with the current snapshot before the membership decision. This
    // handles both flags created and flags removed since initialization; the
    // engine throws for a removed key, which must not become a fatal config
    // error when the correct result is absence.
    this.refreshKnownKeys();
    if (!this.knownKeys.has(flagKey)) {
      return absent(flagKey, defaultValue);
    }

    try {
      return {
        value: run(client, inputs.entityId, inputs.context),
        reason: "TARGETING_MATCH",
      };
    } catch (error) {
      // The key IS in the snapshot, so this is a genuine failure — never
      // FLAG_NOT_FOUND, or the resolver would fall through on a real error.
      return {
        value: defaultValue,
        reason: "ERROR",
        errorCode: ErrorCode.GENERAL,
        errorMessage:
          error instanceof Error ? error.message : "flipt evaluation failed",
      };
    }
  }

  resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context: EvaluationContext,
  ): Promise<ResolutionDetails<boolean>> {
    return Promise.resolve(
      this.evaluate(flagKey, defaultValue, context, (client, entityId, ctx) => {
        return client.evaluateBoolean({ flagKey, entityId, context: ctx })
          .enabled;
      }),
    );
  }

  resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    context: EvaluationContext,
  ): Promise<ResolutionDetails<string>> {
    return Promise.resolve(
      this.evaluate(flagKey, defaultValue, context, (client, entityId, ctx) => {
        return client.evaluateVariant({ flagKey, entityId, context: ctx })
          .variantKey;
      }),
    );
  }

  resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
    context: EvaluationContext,
  ): Promise<ResolutionDetails<number>> {
    const details = this.evaluate(
      flagKey,
      defaultValue,
      context,
      (client, entityId, ctx) => {
        const variant = client.evaluateVariant({
          flagKey,
          entityId,
          context: ctx,
        }).variantKey;
        const parsed = Number(variant);
        if (!Number.isFinite(parsed)) {
          throw new TypeError(
            `variant "${variant}" for flag "${flagKey}" is not a number`,
          );
        }
        return parsed;
      },
    );
    return Promise.resolve(details);
  }

  resolveObjectEvaluation<T extends JsonValue>(
    flagKey: string,
    defaultValue: T,
    _context: EvaluationContext,
  ): Promise<ResolutionDetails<T>> {
    // Object flags are out of scope for v1. Reporting it beats returning the
    // default with a success reason, which a caller could not distinguish from
    // a real resolution.
    return Promise.resolve({
      value: defaultValue,
      reason: "ERROR",
      errorCode: ErrorCode.TYPE_MISMATCH,
      errorMessage: `object flags are not supported (requested "${flagKey}")`,
    });
  }
}
