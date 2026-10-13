export class TrackerError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "CONFLICT" | "BAD_REQUEST" | "FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "TrackerError";
  }
}
