export class HaApiError extends Error {
  public readonly status: number;
  public readonly body: string;

  public constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "HaApiError";
    this.status = status;
    this.body = body;
  }
}

export class HaAuthError extends HaApiError {
  public constructor(status: number, body: string) {
    super(
      `Home Assistant rejected the access token (${String(status)})`,
      status,
      body,
    );
    this.name = "HaAuthError";
  }
}

export class HaNotFoundError extends HaApiError {
  public constructor(resource: string, body: string) {
    super(`Home Assistant resource not found: ${resource}`, 404, body);
    this.name = "HaNotFoundError";
  }
}
