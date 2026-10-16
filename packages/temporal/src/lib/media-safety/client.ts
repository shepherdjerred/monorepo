import { z } from "zod";

export type MediaRequest = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

/** Never include a response body, URL query, or credentials in an error. */
export class MediaApi {
  constructor(
    readonly base: string,
    readonly headers: Record<string, string>,
    readonly request: MediaRequest = fetch,
  ) {}

  async send(endpoint: string, init: RequestInit = {}, timeoutMs = 15_000) {
    const headers = new Headers(this.headers);
    for (const [name, value] of new Headers(init.headers))
      headers.set(name, value);
    let response: Response;
    try {
      response = await this.request(`${this.base}/${endpoint}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
    } catch {
      throw new Error(
        `Media API ${init.method ?? "GET"} ${endpoint.replace(/\?.*$/u, "")} request failed or timed out`,
      );
    }
    if (!response.ok) {
      throw new Error(
        `Media API ${init.method ?? "GET"} failed: HTTP ${String(response.status)}`,
      );
    }
    return response;
  }

  async json(endpoint: string) {
    const response = await this.send(endpoint);
    const body: unknown = await response.json();
    return body;
  }

  async pages<T>(endpoint: string, schema: z.ZodType<T>) {
    const records: T[] = [];
    let page = 1;
    for (;;) {
      const separator = endpoint.includes("?") ? "&" : "?";
      const result = z
        .object({
          totalRecords: z.number().int().nonnegative(),
          records: z.array(schema),
        })
        .parse(
          await this.json(
            `${endpoint}${separator}pageSize=100&page=${String(page)}`,
          ),
        );
      records.push(...result.records);
      if (records.length >= result.totalRecords) return records;
      if (result.records.length === 0)
        throw new Error("Media API pagination ended early");
      page++;
    }
  }

  async form(endpoint: string, values: Record<string, string>) {
    return this.send(endpoint, {
      method: "POST",
      body: new URLSearchParams(values),
    });
  }
}

export async function loginQbittorrent(
  url: string,
  username: string,
  password: string,
  request: MediaRequest = fetch,
) {
  const api = new MediaApi(url, {}, request);
  const response = await api.form("api/v2/auth/login", { username, password });
  const cookie = response.headers
    .getSetCookie()
    .map((entry) => entry.replace(/;.*$/u, ""))
    .find((entry) => /^QBT_SID_\d+=.+$/u.test(entry));
  if (cookie === undefined || response.status !== 204) {
    throw new Error("qBittorrent authentication failed");
  }
  return new MediaApi(`${url}/api/v2`, { Cookie: cookie }, request);
}
