export class DeliveryError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "CONFLICT"
      | "BUSY"
      | "FORBIDDEN"
      | "UNAUTHORIZED"
      | "INVALID"
      | "PAUSED"
      /**
       * A dependency Delivery reads through is briefly unreachable, such as
       * the Kubernetes API during a control-plane restart. Unlike PAUSED,
       * which is a refusal, the caller may retry the same request.
       */
      | "UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "DeliveryError";
  }
}
