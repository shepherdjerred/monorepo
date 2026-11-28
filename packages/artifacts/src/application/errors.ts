import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "CONFLICT"
  | "FORBIDDEN"
  | "PAYLOAD_TOO_LARGE"
  | "UNPROCESSABLE_CONTENT"
  | "GONE";

/** HTTP status of each code, for the Hono routes. */
export const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  FORBIDDEN: 403,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE_CONTENT: 422,
  GONE: 410,
};

/**
 * An expected failure of a request, carried to the transport that maps it.
 * `data` is returned to the caller as the body of a conflict (the current
 * version, the missing digests or the current board document).
 */
export class ArtifactsError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ArtifactsError";
  }
}
