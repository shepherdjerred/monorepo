const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;
const REQUEST_TIMEOUT_MS = 20_000;
const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set([
  "ConnectionRefused",
  "ConnectionReset",
  "DNS",
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
  "SocketClosed",
  "Timeout",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);
const RETRYABLE_ERROR_NAMES = new Set(["AbortError", "TimeoutError"]);
const RETRYABLE_MESSAGE_FRAGMENTS = [
  "connection refused",
  "connection reset",
  "dns lookup",
  "getaddrinfo",
  "name resolution",
  "socket closed",
  "timed out",
  "unable to connect",
] as const;

type FetchFunction = (url: string, init: RequestInit) => Promise<Response>;

export type GithubTagArchiveFetchOptions = {
  fetchFn?: FetchFunction;
  sleepFn?: (milliseconds: number) => Promise<void>;
  warnFn?: (message: string) => void;
  requestTimeoutMs?: number;
};

class GithubArchiveHttpError extends Error {
  public constructor(
    url: string,
    public readonly status: number,
    statusText: string,
  ) {
    super(`Failed to fetch ${url}: HTTP ${String(status)} ${statusText}`);
    this.name = "GithubArchiveHttpError";
  }
}

function readStringProperty(
  value: unknown,
  property: "code" | "message" | "name",
): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  switch (property) {
    case "code":
      return "code" in value && typeof value.code === "string"
        ? value.code
        : null;
    case "message":
      return "message" in value && typeof value.message === "string"
        ? value.message
        : null;
    case "name":
      return "name" in value && typeof value.name === "string"
        ? value.name
        : null;
  }
}

function readCause(value: unknown): unknown {
  if (typeof value !== "object" || value === null || !("cause" in value)) {
    return undefined;
  }
  return value.cause;
}

export function isRetryableGithubArchiveError(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current !== undefined; depth += 1) {
    const code = readStringProperty(current, "code");
    if (code !== null && RETRYABLE_ERROR_CODES.has(code)) {
      return true;
    }

    const name = readStringProperty(current, "name");
    if (name !== null && RETRYABLE_ERROR_NAMES.has(name)) {
      return true;
    }

    const message = readStringProperty(current, "message")?.toLowerCase();
    if (
      message !== undefined &&
      RETRYABLE_MESSAGE_FRAGMENTS.some((fragment) => message.includes(fragment))
    ) {
      return true;
    }

    current = readCause(current);
  }

  return false;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function githubTagArchiveUrl(repo: string, version: string): string {
  return `https://codeload.github.com/${repo}/tar.gz/refs/tags/${version}`;
}

export async function fetchGithubTagArchive(
  repo: string,
  version: string,
  options: GithubTagArchiveFetchOptions = {},
): Promise<Uint8Array> {
  const fetchFn = options.fetchFn ?? fetch;
  const sleepFn = options.sleepFn ?? Bun.sleep;
  const warnFn = options.warnFn ?? console.warn;
  const requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const url = githubTagArchiveUrl(repo, version);
  const totalAttempts = RETRY_DELAYS_MS.length + 1;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      const response = await fetchFn(url, {
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (!response.ok) {
        throw new GithubArchiveHttpError(
          url,
          response.status,
          response.statusText,
        );
      }

      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      const retryable =
        error instanceof GithubArchiveHttpError
          ? RETRYABLE_HTTP_STATUSES.has(error.status)
          : isRetryableGithubArchiveError(error);

      if (!retryable) {
        throw error;
      }

      if (attempt === totalAttempts) {
        throw new Error(
          `[${repo}] Failed to fetch ${url} after ${String(totalAttempts)} attempts: ${describeError(error)}`,
          { cause: error },
        );
      }

      const delayMs = RETRY_DELAYS_MS[attempt - 1];
      if (delayMs === undefined) {
        throw new Error(
          `[${repo}] Missing retry delay for attempt ${String(attempt)}`,
          { cause: error },
        );
      }
      warnFn(
        `[${repo}] Transient archive fetch failure on attempt ${String(attempt)}/${String(totalAttempts)}: ${describeError(error)}; retrying in ${String(delayMs)}ms`,
      );
      await sleepFn(delayMs);
    }
  }

  throw new Error(`[${repo}] Archive fetch retry loop ended unexpectedly`);
}
