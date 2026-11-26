import {
  createTRPCClient,
  httpLink,
  TRPCClientError,
  type TRPCClient,
} from "@trpc/client";
import { z } from "zod";
import {
  ACTOR_HEADER,
  type Actor,
  type AppRouter,
} from "@shepherdjerred/artifacts/contract";
import { ArtifactsCliError, redactTokens } from "./errors.ts";

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type ArtifactsClientOptions = {
  baseUrl: string;
  /** Null for read-only commands run where no actor can be detected. */
  actor: Actor | null;
  /** Defaults to global `fetch`; tests and the contract test inject one. */
  fetch?: FetchLike;
  /** Per-request deadline. Defaults to 30 s; streams and uploads pass null. */
  timeoutMs?: number | null;
};

export type RequestOptions = Omit<RequestInit, "signal"> & {
  signal?: AbortSignal | null | undefined;
  timeoutMs?: number | null | undefined;
};

/** tRPC call options for an optional signal (`exactOptionalPropertyTypes`). */
export function callOptions(signal: AbortSignal | undefined): {
  signal?: AbortSignal;
} {
  return signal === undefined ? {} : { signal };
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function artifactsBaseUrl(value: string): string {
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new ArtifactsCliError(
      "usage",
      "The artifacts URL must be an HTTP(S) base URL without credentials, query, or fragment. Set ARTIFACTS_URL or [artifacts].url in ~/.toolkit/config.toml.",
    );
  return url.toString().replace(/\/$/u, "");
}

/** Base64 of the UTF-8 JSON actor, as Tracker's header carries it. */
export function encodeActorHeader(actor: Actor): string {
  return Buffer.from(JSON.stringify(actor), "utf8").toString("base64");
}

const UNREACHABLE_FIX =
  "Is this machine on the tailnet? Check `tailscale status`, then retry.";

function networkFailure(
  error: unknown,
  caller: AbortSignal | null | undefined,
  baseUrl: string,
): unknown {
  if (caller?.aborted === true) return error;
  return error instanceof DOMException && error.name === "TimeoutError"
    ? new ArtifactsCliError(
        "timeout",
        `The artifacts service at ${baseUrl} did not answer in time. ${UNREACHABLE_FIX}`,
        { cause: error },
      )
    : new ArtifactsCliError(
        "unreachable",
        `Cannot reach the artifacts service at ${baseUrl}. ${UNREACHABLE_FIX}`,
        { cause: error },
      );
}

const FORBIDDEN_FIX = (baseUrl: string) =>
  `The artifacts service at ${baseUrl} refused this login (HTTP 403). Your Tailscale login must be in the service's operatorLogins; agents on tagged nodes get no login at all. Ask Jerred to add it, or run from a machine signed in as an operator.`;

const TrpcDataSchema = z.looseObject({
  httpStatus: z.number().optional(),
  code: z.string().optional(),
});

function messageFromBody(text: string): string {
  const trimmed = text.trim();
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const found = z
      .looseObject({
        error: z.unknown().optional(),
        message: z.string().optional(),
      })
      .safeParse(parsed);
    if (found.success) {
      if (typeof found.data.error === "string") return found.data.error;
      if (found.data.message !== undefined) return found.data.message;
    }
  } catch {
    // Not JSON: use the text.
  }
  return trimmed.slice(0, 300);
}

/** Turns an HTTP status and message into the failure that names its fix. */
export function failureForStatus(
  status: number,
  message: string,
  baseUrl: string,
): ArtifactsCliError {
  const text = redactTokens(message);
  if (status === 401 || status === 403)
    return new ArtifactsCliError("forbidden", FORBIDDEN_FIX(baseUrl));
  if (status === 404)
    return new ArtifactsCliError(
      "not-found",
      `Not found (HTTP 404)${text === "" ? "" : `: ${text}`}. If every command says this, the service is older than this toolkit.`,
    );
  if (status === 409) return new ArtifactsCliError("conflict", text);
  if (status >= 500)
    return new ArtifactsCliError(
      "server",
      `The artifacts service failed (HTTP ${String(status)})${text === "" ? "" : `: ${text}`}. It is retried automatically while waiting; otherwise run again.`,
    );
  return new ArtifactsCliError(
    "rejected",
    `The artifacts service rejected the request (HTTP ${String(status)})${text === "" ? "" : `: ${text}`}`,
  );
}

/** Reads a non-2xx response into the failure that names its fix. */
export async function failureFromResponse(
  response: Response,
  baseUrl: string,
): Promise<ArtifactsCliError> {
  const text = await response.text().catch(() => "");
  return failureForStatus(response.status, messageFromBody(text), baseUrl);
}

/**
 * Normalizes anything thrown by a client call. An aborted call (the caller's
 * signal) passes through so cancellation is never reported as a failure.
 */
export function explainFailure(error: unknown, baseUrl: string): unknown {
  if (error instanceof ArtifactsCliError) return error;
  if (!(error instanceof TRPCClientError)) return error;
  const cause: unknown = error.cause;
  if (cause instanceof ArtifactsCliError) return cause;
  if (cause instanceof Error && cause.name === "AbortError") return cause;
  const data = TrpcDataSchema.safeParse(error.data);
  const code = data.success ? data.data.code : undefined;
  const httpStatus = data.success ? data.data.httpStatus : undefined;
  const kind =
    code === "CONFLICT"
      ? "conflict"
      : code === "NOT_FOUND"
        ? "not-found"
        : null;
  return kind === null
    ? failureForStatus(httpStatus ?? 500, error.message, baseUrl)
    : new ArtifactsCliError(kind, redactTokens(error.message), {
        cause: error,
      });
}

export type ArtifactsClient = {
  baseUrl: string;
  actor: Actor | null;
  trpc: TRPCClient<AppRouter>;
  /** A raw call with the actor header; network failures become `ArtifactsCliError`. */
  request: (path: string, init?: RequestOptions) => Promise<Response>;
  /** Maps whatever a call threw into an `ArtifactsCliError` (abort passes through). */
  explain: (error: unknown) => unknown;
};

export function createArtifactsClient(
  options: ArtifactsClientOptions,
): ArtifactsClient {
  const baseUrl = artifactsBaseUrl(options.baseUrl);
  const doFetch: FetchLike =
    options.fetch ?? ((input, init) => fetch(input, init));
  const defaultTimeout =
    options.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : options.timeoutMs;
  const actorHeaders: Record<string, string> =
    options.actor === null
      ? {}
      : { [ACTOR_HEADER]: encodeActorHeader(options.actor) };

  async function send(
    url: string,
    init: RequestOptions = {},
  ): Promise<Response> {
    const { timeoutMs, signal: caller, ...rest } = init;
    const timeout = timeoutMs === undefined ? defaultTimeout : timeoutMs;
    const signals = [
      ...(caller === null || caller === undefined ? [] : [caller]),
      ...(timeout === null ? [] : [AbortSignal.timeout(timeout)]),
    ];
    const headers = new Headers(rest.headers);
    for (const [name, value] of Object.entries(actorHeaders))
      headers.set(name, value);
    try {
      return await doFetch(url, {
        ...rest,
        headers,
        ...(signals.length === 0 ? {} : { signal: AbortSignal.any(signals) }),
      });
    } catch (error) {
      throw networkFailure(error, caller, baseUrl);
    }
  }

  const trpc = createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: `${baseUrl}/trpc`,
        fetch: async (url, init) => {
          const response = await send(String(url), {
            ...init,
            signal: init?.signal,
          });
          if (response.status === 401 || response.status === 403)
            throw failureForStatus(response.status, "", baseUrl);
          return {
            status: response.status,
            ok: response.ok,
            headers: response.headers,
            json: (): Promise<unknown> => response.json(),
            text: () => response.text(),
            body: null,
          };
        },
      }),
    ],
  });

  return {
    baseUrl,
    actor: options.actor,
    trpc,
    request: (path, init) => send(`${baseUrl}${path}`, init),
    explain: (error) => explainFailure(error, baseUrl),
  };
}
