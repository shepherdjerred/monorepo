/**
 * Signals that Discord delivery already happened before a durable output
 * record failed. The active-game detector must retain its deduplication row in
 * this case so the next spectator poll cannot send duplicate messages.
 */
export class PrematchNotificationPostDeliveryError extends Error {
  constructor(cause: unknown) {
    super("Prematch output persistence failed after Discord delivery", {
      cause,
    });
    this.name = "PrematchNotificationPostDeliveryError";
  }
}
