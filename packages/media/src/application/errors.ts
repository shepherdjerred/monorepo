export class MediaError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 502 | 503 = 400,
  ) {
    super(message);
    this.name = "MediaError";
  }
}

export function requireOwner(actor: { role: string }): void {
  if (actor.role !== "owner") {
    throw new MediaError(
      "forbidden",
      "This action requires the owner role",
      403,
    );
  }
}
