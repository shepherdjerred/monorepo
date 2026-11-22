import {
  ErrorCode,
  type EvaluationContext,
  type JsonValue,
  type Provider,
  type ResolutionDetails,
} from "@openfeature/server-sdk";
import {
  parseFlagsDeployment,
  validateFlagsUrl,
} from "@shepherdjerred/feature-flags/config/schema.ts";
import {
  evaluateBoolean,
  evaluateNumber,
  evaluateVariant,
  type FlagEvaluation,
  type FlagValue,
} from "@shepherdjerred/feature-flags/evaluate.ts";
import { FlagsDeploymentSnapshotSchema } from "@shepherdjerred/feature-flags/flags-drift.ts";
import { toFliptInputs } from "@shepherdjerred/feature-flags/providers/flipt-context.ts";
import {
  createFreshSnapshotGate,
  observeCompletion,
  settleRefresh,
  SnapshotUnavailableError,
} from "@shepherdjerred/feature-flags/providers/snapshot-refresh.ts";

const DEFAULT_REQUEST_TIMEOUT_MILLISECONDS = 10_000;

export type FlagsHttpResponse = {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly headers: { get: (name: string) => string | null };
  json: () => Promise<unknown>;
};

export type FlagsFetcher = (
  url: string,
  init: {
    readonly method: "GET";
    readonly headers: Readonly<Record<string, string>>;
    readonly signal: AbortSignal;
  },
) => Promise<FlagsHttpResponse>;

export type FlagsProviderOptions = {
  readonly url: string;
  readonly deployment: string;
  readonly pollIntervalSeconds: number;
  readonly requestTimeoutMilliseconds?: number;
  /** Injected by tests to exercise polling, ETag, and validation without sockets. */
  readonly fetcher?: FlagsFetcher;
  /** Called when a refresh cannot obtain a valid snapshot. */
  readonly onRefreshFailure?: () => void;
  /** Receives the current successful-snapshot age for the process registry. */
  readonly onSnapshotAge?: (seconds: number) => void;
};

function absent<T>(
  flagKey: string,
  deployment: string,
  defaultValue: T,
): ResolutionDetails<T> {
  return {
    value: defaultValue,
    reason: "ERROR",
    errorCode: ErrorCode.FLAG_NOT_FOUND,
    errorMessage: `flag "${flagKey}" is not defined in flags deployment "${deployment}"`,
  };
}

function notReady<T>(defaultValue: T): ResolutionDetails<T> {
  return {
    value: defaultValue,
    reason: "ERROR",
    errorCode: ErrorCode.PROVIDER_NOT_READY,
    errorMessage: "flags provider has not initialized",
  };
}

type FlagsSnapshot = {
  readonly revision: number;
  readonly flags: readonly FlagValue[];
};

function parseSnapshotBody(
  raw: unknown,
  expectedDeployment: string,
): FlagsSnapshot {
  const parsed = FlagsDeploymentSnapshotSchema.parse(raw);
  if (parsed.deployment !== expectedDeployment) {
    throw new Error(
      `flags snapshot deployment "${parsed.deployment}" does not match configured deployment "${expectedDeployment}"`,
    );
  }
  const seen = new Set<string>();
  for (const flag of parsed.flags) {
    if (seen.has(flag.key)) {
      throw new Error(`duplicate flag key in snapshot: ${flag.key}`);
    }
    seen.add(flag.key);
  }
  return { revision: parsed.revision, flags: parsed.flags };
}

type FetchedSnapshotResponse =
  | {
      readonly kind: "not-modified";
      readonly etag: string | null;
    }
  | {
      readonly kind: "snapshot";
      readonly raw: unknown;
      readonly etag: string | null;
    };

async function fetchSnapshotWithBoundary(input: {
  readonly fetcher: FlagsFetcher;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly providerSignal: AbortSignal;
  readonly timeoutMilliseconds: number;
}): Promise<FetchedSnapshotResponse> {
  const signal = AbortSignal.any([
    input.providerSignal,
    AbortSignal.timeout(input.timeoutMilliseconds),
  ]);
  const isAborted = (): boolean => signal.aborted;
  if (isAborted()) {
    throw new SnapshotUnavailableError("Flags snapshot request aborted");
  }
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(new SnapshotUnavailableError("Flags snapshot request aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([
      (async (): Promise<FetchedSnapshotResponse> => {
        const response = await input.fetcher(input.url, {
          method: "GET",
          headers: input.headers,
          signal,
        });
        if (response.status === 304) {
          return {
            kind: "not-modified",
            etag: response.headers.get("etag"),
          };
        }
        if (response.status !== 200) {
          throw new SnapshotUnavailableError(
            `flags snapshot request failed: ${String(response.status)} ${response.statusText}`,
          );
        }
        const raw = await response.json();
        return {
          kind: "snapshot",
          raw,
          etag: response.headers.get("etag"),
        };
      })(),
      aborted,
    ]);
  } catch (error) {
    if (error instanceof SnapshotUnavailableError) throw error;
    if (isAborted()) {
      throw new SnapshotUnavailableError("Flags snapshot request aborted", {
        cause: error,
      });
    }
    if (error instanceof SyntaxError) throw error;
    throw new SnapshotUnavailableError("Flags snapshot transport unavailable", {
      cause: error,
    });
  } finally {
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  }
}

/**
 * OpenFeature provider backed by the first-party `flags` service's deployment
 * snapshot endpoint (`GET /v1/deployments/:catalog/:stage/snapshot`).
 *
 * Snapshot reads are credentialless (enforced by NetworkPolicy and rejected by
 * the server if `Authorization` is sent). Evaluation runs in-memory via
 * `evaluate.ts`; conditional `If-None-Match` polling keeps the snapshot current
 * while retaining the last good snapshot across backend outages.
 */
export class FlagsProvider implements Provider {
  readonly runsOn = "server";
  readonly metadata = { name: "FlagsProvider" } as const;

  private readonly options: FlagsProviderOptions;
  private readonly snapshotUrl: string;
  private snapshot: FlagsSnapshot | undefined;
  private etag: string | undefined;
  private lastSuccessfulRefreshMs: number | undefined;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private snapshotAgeTimer: ReturnType<typeof setInterval> | undefined;
  private readonly controller = new AbortController();
  private refreshTask: Promise<void> | undefined;
  private readonly checkFreshSnapshot = createFreshSnapshotGate(() =>
    this.enqueueRefresh(),
  );
  private closed = false;

  constructor(options: FlagsProviderOptions) {
    const urlProblem = validateFlagsUrl(options.url);
    if (urlProblem !== undefined) {
      throw new Error(urlProblem);
    }
    const parsedDeployment = parseFlagsDeployment(options.deployment);
    if (parsedDeployment === undefined) {
      throw new Error(
        `FLAGS_DEPLOYMENT must be "<catalog>/<stage>", received "${options.deployment}"`,
      );
    }
    this.options = options;
    const base = options.url.replace(/\/+$/u, "");
    this.snapshotUrl = `${base}/v1/deployments/${encodeURIComponent(parsedDeployment.catalog)}/${encodeURIComponent(parsedDeployment.stage)}/snapshot`;
  }

  async initialize(): Promise<void> {
    if (this.closed || this.snapshot !== undefined) {
      throw new Error("Flags provider already initialized or closed");
    }
    await this.performRefresh(undefined);
    if (this.options.pollIntervalSeconds > 0) {
      this.refreshTimer = setInterval(() => {
        if (this.refreshTask === undefined) {
          void this.enqueueRefresh();
        }
      }, this.options.pollIntervalSeconds * 1000);
      this.refreshTimer.unref();
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
      this.snapshotAgeTimer.unref();
    }
  }

  onClose(): Promise<void> {
    this.closed = true;
    this.controller.abort();
    if (this.refreshTimer !== undefined) clearInterval(this.refreshTimer);
    if (this.snapshotAgeTimer !== undefined) {
      clearInterval(this.snapshotAgeTimer);
    }
    this.refreshTimer = undefined;
    this.snapshotAgeTimer = undefined;
    this.snapshot = undefined;
    this.etag = undefined;
    this.lastSuccessfulRefreshMs = undefined;
    return settleRefresh(this.refreshTask);
  }

  snapshotAgeSeconds(): number | undefined {
    return this.lastSuccessfulRefreshMs === undefined
      ? undefined
      : (Date.now() - this.lastSuccessfulRefreshMs) / 1000;
  }

  /** Opt-in authority check for destructive operations; ordinary reads stay cached. */
  refreshForEvaluation(): Promise<boolean> {
    return this.closed || this.snapshot === undefined
      ? Promise.resolve(false)
      : this.checkFreshSnapshot();
  }

  private enqueueRefresh(): Promise<void> {
    const refresh = this.performRefresh(this.refreshTask);
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
    preceding: Promise<void> | undefined,
  ): Promise<void> {
    await settleRefresh(preceding);
    if (this.isClosed()) {
      throw new SnapshotUnavailableError("Flags provider is closed");
    }
    const sentEtag = this.etag;
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(sentEtag === undefined ? {} : { "If-None-Match": sentEtag }),
    };
    const fetcher: FlagsFetcher =
      this.options.fetcher ?? ((url, init) => fetch(url, init));
    const timeoutMilliseconds =
      this.options.requestTimeoutMilliseconds ??
      DEFAULT_REQUEST_TIMEOUT_MILLISECONDS;

    try {
      const fetched = await fetchSnapshotWithBoundary({
        fetcher,
        url: this.snapshotUrl,
        headers,
        providerSignal: this.controller.signal,
        timeoutMilliseconds,
      });
      this.applyRefreshResponse(fetched, sentEtag);
    } catch (error) {
      if (!this.isClosed()) this.options.onRefreshFailure?.();
      throw error;
    }
  }

  private applyRefreshResponse(
    fetched: FetchedSnapshotResponse,
    sentEtag: string | undefined,
  ): void {
    if (this.isClosed()) {
      throw new SnapshotUnavailableError(
        "Flags provider closed during refresh",
      );
    }
    if (fetched.kind === "not-modified") {
      if (sentEtag === undefined || this.snapshot === undefined) {
        throw new Error("Unconditional flags snapshot request returned 304");
      }
      if (fetched.etag !== null && fetched.etag !== sentEtag) {
        throw new SnapshotUnavailableError(
          "Flags snapshot returned a mismatched conditional validator",
        );
      }
      this.recordSuccessfulRefresh();
      return;
    }
    const validated = parseSnapshotBody(fetched.raw, this.options.deployment);
    if (
      this.snapshot !== undefined &&
      validated.revision < this.snapshot.revision
    ) {
      throw new SnapshotUnavailableError(
        "Flags snapshot revision moved backward",
      );
    }
    this.snapshot = validated;
    this.etag =
      fetched.etag !== null && fetched.etag.length > 0
        ? fetched.etag
        : undefined;
    this.recordSuccessfulRefresh();
  }

  private recordSuccessfulRefresh(): void {
    this.lastSuccessfulRefreshMs = Date.now();
    this.updateSnapshotAge();
  }

  private updateSnapshotAge(): void {
    const age = this.snapshotAgeSeconds();
    if (age !== undefined) {
      this.options.onSnapshotAge?.(age);
    }
  }

  private evaluateFromSnapshot<T>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext,
    run: (
      flags: readonly FlagValue[],
      mappedContext: Readonly<Record<string, string>>,
    ) => FlagEvaluation<T>,
  ): ResolutionDetails<T> {
    const flags = this.snapshot?.flags;
    if (flags === undefined || this.closed) {
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
    const evaluated = run(flags, inputs.context);
    switch (evaluated.kind) {
      case "missing":
        return absent(flagKey, this.options.deployment, defaultValue);
      case "type-mismatch":
      case "invalid":
        return {
          value: defaultValue,
          reason: "ERROR",
          errorCode: ErrorCode.TYPE_MISMATCH,
          errorMessage: evaluated.message,
        };
      case "value":
        return {
          value: evaluated.value,
          reason: "TARGETING_MATCH",
        };
    }
  }

  private async resolveWithRefresh<T>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext,
    run: (
      flags: readonly FlagValue[],
      mappedContext: Readonly<Record<string, string>>,
    ) => FlagEvaluation<T>,
  ): Promise<ResolutionDetails<T>> {
    const first = this.evaluateFromSnapshot(
      flagKey,
      defaultValue,
      context,
      run,
    );
    if (first.errorCode !== ErrorCode.FLAG_NOT_FOUND) return first;
    const refreshed = await this.refreshForEvaluation();
    return refreshed
      ? this.evaluateFromSnapshot(flagKey, defaultValue, context, run)
      : first;
  }

  resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context: EvaluationContext,
  ): Promise<ResolutionDetails<boolean>> {
    return this.resolveWithRefresh(
      flagKey,
      defaultValue,
      context,
      (flags, mappedContext) => evaluateBoolean(flags, flagKey, mappedContext),
    );
  }

  resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    context: EvaluationContext,
  ): Promise<ResolutionDetails<string>> {
    return this.resolveWithRefresh(flagKey, defaultValue, context, (flags) =>
      evaluateVariant(flags, flagKey),
    );
  }

  resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
    context: EvaluationContext,
  ): Promise<ResolutionDetails<number>> {
    return this.resolveWithRefresh(flagKey, defaultValue, context, (flags) =>
      evaluateNumber(flags, flagKey),
    );
  }

  resolveObjectEvaluation<T extends JsonValue>(
    flagKey: string,
    defaultValue: T,
    _context: EvaluationContext,
  ): Promise<ResolutionDetails<T>> {
    return Promise.resolve({
      value: defaultValue,
      reason: "ERROR",
      errorCode: ErrorCode.TYPE_MISMATCH,
      errorMessage: `object flags are not supported (requested "${flagKey}")`,
    });
  }
}
