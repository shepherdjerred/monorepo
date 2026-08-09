/**
 * Application errors carry a `kind` tag, not just a `name` string.
 *
 * The tag is the discriminant: `AppError` is a real discriminated union, so
 * `switch (error.kind)` narrows and the compiler enforces exhaustiveness.
 * `name` is retained purely as the human-readable label `Error` already has
 * (it is what shows up in stack traces and dead-letter entries); nothing may
 * branch on it.
 *
 * The tag is also the serialized form: an `AppError` round-trips through
 * language-neutral JSON as `{ kind, message, status? }`, which is what lets
 * the same fixtures drive a non-TypeScript implementation.
 */
export class TaskNotesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskNotesError";
  }
}

export class NetworkError extends TaskNotesError {
  readonly kind = "network" as const;

  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "NetworkError";
  }
}

export class ApiError extends TaskNotesError {
  readonly kind = "api" as const;

  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class ValidationError extends TaskNotesError {
  readonly kind = "validation" as const;

  constructor(
    message: string,
    public readonly zodErrors?: unknown,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * A 404 from the server. Deliberately a sibling of `ApiError` rather than a
 * subclass: a subclass cannot narrow the inherited `kind` tag, and the whole
 * point of the tag is that each error is exactly one variant. It keeps
 * `status: 404` so every HTTP-shaped error serializes identically.
 */
export class NotFoundError extends TaskNotesError {
  readonly kind = "not_found" as const;
  readonly status = 404 as const;

  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`);
    this.name = "NotFoundError";
  }
}

export class ConnectionError extends TaskNotesError {
  readonly kind = "connection" as const;

  constructor(message = "Unable to connect to TaskNotes server") {
    super(message);
    this.name = "ConnectionError";
  }
}

export type AppError =
  | NetworkError
  | ApiError
  | ValidationError
  | NotFoundError
  | ConnectionError;

/**
 * The closed set of error tags, derived from the union so it can never drift
 * from the classes. Mirrors the Rust `enum ErrorKind`.
 */
export type ErrorKind = AppError["kind"];
