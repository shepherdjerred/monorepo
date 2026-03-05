export class TaskNotesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskNotesError";
  }
}

export class NetworkError extends TaskNotesError {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "NetworkError";
  }
}

export class ApiError extends TaskNotesError {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class ValidationError extends TaskNotesError {
  constructor(
    message: string,
    public readonly zodErrors?: unknown,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends ApiError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 404);
    this.name = "NotFoundError";
  }
}

export class ConnectionError extends TaskNotesError {
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
