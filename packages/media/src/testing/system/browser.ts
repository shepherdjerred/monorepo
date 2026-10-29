/** Cookie/CSRF behavior of one browser, talking only to the owned loopback API. */
export class SystemHttpBrowser {
  private readonly cookies = new Map<string, string>();

  constructor(private readonly origin: string) {
    if (new URL(origin).hostname !== "127.0.0.1")
      throw new Error("System browser requires an owned loopback server");
  }

  async request(
    path: string,
    input: { method?: string; body?: unknown; key?: string } = {},
  ): Promise<Response> {
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin)
      throw new Error(
        "System browser cannot forward cookies to another origin",
      );
    const headers = new Headers({ Origin: this.origin });
    headers.set(
      "Cookie",
      [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "),
    );
    const csrf = this.cookies.get("media-csrf");
    if (csrf !== undefined) headers.set("X-CSRF-Token", csrf);
    if (input.key !== undefined) headers.set("Idempotency-Key", input.key);
    if (input.body !== undefined)
      headers.set("Content-Type", "application/json");
    const response = await fetch(url, {
      method: input.method ?? (input.body === undefined ? "GET" : "POST"),
      headers,
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      redirect: "error",
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0];
      if (pair === undefined) throw new Error("Response cookie missing");
      const separator = pair.indexOf("=");
      if (separator <= 0) throw new Error("Response cookie invalid");
      const key = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (value.length === 0) this.cookies.delete(key);
      else this.cookies.set(key, value);
    }
    return response;
  }
}
