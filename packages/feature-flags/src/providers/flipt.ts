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

export type FliptProviderOptions = {
  readonly url: string;
  readonly namespace: string;
  readonly environment: string;
  readonly pollIntervalSeconds: number;
  /** Injected by tests to drive the real WASM engine without a network. */
  readonly fetcher?: FliptFetcher;
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
 * Verified against flipt/flipt:v2.11.0, not assumed from docs:
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
  private lastKeyRefreshMs: number | undefined;

  constructor(options: FliptProviderOptions) {
    this.options = options;
  }

  async initialize(): Promise<void> {
    const fetcher =
      this.options.fetcher ??
      createFliptFetcher({
        url: this.options.url,
        namespace: this.options.namespace,
        environment: this.options.environment,
      });

    this.client = await createFliptEvaluationClient({
      url: this.options.url,
      namespace: this.options.namespace,
      environment: this.options.environment,
      updateInterval: this.options.pollIntervalSeconds,
      fetcher,
    });
    this.refreshKnownKeys();
  }

  onClose(): Promise<void> {
    // Clears the refresh interval. Without it `bun test` hangs on the open
    // timer and a pod leaks a poller past shutdown.
    this.client?.close();
    this.client = undefined;
    this.knownKeys = new Set();
    this.lastKeyRefreshMs = undefined;
    return Promise.resolve();
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
    this.lastKeyRefreshMs = Date.now();
  }

  /**
   * Seconds since the key set was last read from a snapshot, or `undefined`
   * before the first successful initialize.
   *
   * This is the outage signal. During a backend outage the client keeps serving
   * its last good snapshot, so evaluations still succeed and nothing looks
   * wrong; a rising age is what tells an operator the values are frozen. See
   * `observability.ts` for why this replaces per-evaluation reporting.
   */
  snapshotAgeSeconds(): number | undefined {
    return this.lastKeyRefreshMs === undefined
      ? undefined
      : (Date.now() - this.lastKeyRefreshMs) / 1000;
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

    if (!this.knownKeys.has(flagKey)) {
      // The snapshot may have advanced since the last refresh. Re-read once
      // before declaring the key absent so a newly created flag is picked up.
      this.refreshKnownKeys();
      if (!this.knownKeys.has(flagKey)) {
        return absent(flagKey, defaultValue);
      }
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
