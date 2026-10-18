export class DeliveryError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "CONFLICT"
      | "BUSY"
      | "FORBIDDEN"
      | "UNAUTHORIZED"
      | "INVALID"
      | "PAUSED",
    message: string,
  ) {
    super(message);
    this.name = "DeliveryError";
  }
}
