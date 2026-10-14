/** Expected boundary failures that are safe to show to a player. */
export class UserError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
