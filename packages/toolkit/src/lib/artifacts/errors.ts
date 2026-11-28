import { WAIT_EXIT_CODES } from "@shepherdjerred/artifacts/contract";

/**
 * Exit codes of `toolkit artifacts`, shared with the `ci` commands: 2 covers
 * usage and every service failure, 4 means the watched board or artifact is
 * gone, 6 means a requested `--timeout` elapsed (not a failure), and a
 * signal ends the process with 128 plus its number.
 */
export const EXIT = {
  ok: WAIT_EXIT_CODES.ok,
  error: WAIT_EXIT_CODES.usage,
  gone: WAIT_EXIT_CODES.gone,
  timeout: WAIT_EXIT_CODES.timeout,
  sigint: 130,
  sigterm: 143,
} as const;

/**
 * What went wrong, so a long-running `wait` can tell a transient failure (keep
 * waiting) from one only the operator can fix (stop).
 */
export type FailureKind =
  | "usage"
  | "unreachable"
  | "timeout"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "server"
  | "rejected";

/** A failure with a message that names the fix. Never carries secrets. */
export class ArtifactsCliError extends Error {
  readonly kind: FailureKind;
  readonly exitCode: number;
  constructor(
    kind: FailureKind,
    message: string,
    options: { exitCode?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? {} : { cause: options.cause });
    this.name = "ArtifactsCliError";
    this.kind = kind;
    this.exitCode = options.exitCode ?? EXIT.error;
  }

  /** Worth retrying: the service may simply be briefly out of reach. */
  get transient(): boolean {
    return (
      this.kind === "unreachable" ||
      this.kind === "timeout" ||
      this.kind === "server"
    );
  }
}

export function usageError(message: string): ArtifactsCliError {
  return new ArtifactsCliError("usage", message);
}

/** A content URL's token segment is a capability; never print it. */
const CONTENT_TOKEN = /(\/_t\/)[\w-]{12,}/gu;

export function redactTokens(text: string): string {
  return text.replaceAll(CONTENT_TOKEN, "$1[redacted]");
}
