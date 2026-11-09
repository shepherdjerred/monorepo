/** Expected caller/controller stop, before any publishing action. */
export class LocalPromotionStop extends Error {
  constructor(
    readonly reason:
      | "pending"
      | "paused"
      | "blocked"
      | "cooldown"
      | "owner"
      | "uncertain"
      | "history"
      | "budget",
    message: string,
  ) {
    super(message);
    this.name = "LocalPromotionStop";
  }
}
