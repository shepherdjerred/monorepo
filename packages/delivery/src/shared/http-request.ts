import type { z } from "zod";
import { ApiErrorSchema } from "./contract.ts";
import { DeliveryClientError } from "./client-error.ts";

export type RequestOptions = {
  baseUrl: string;
  fetch?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
  headers?: ConstructorParameters<typeof Headers>[0];
};

/** One validated JSON request against the Delivery API. */
export function createRequester(options: RequestOptions) {
  const transport = options.fetch ?? fetch;
  return async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set("Accept", "application/json");
    if (!headers.has("Authorization") && options.baseUrl.startsWith("http"))
      headers.set("Origin", new URL(options.baseUrl).origin);
    if (body !== undefined) headers.set("Content-Type", "application/json");
    const response = await transport(
      `${options.baseUrl.replace(/\/$/, "")}/api/v1${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers,
        credentials: "same-origin",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    const raw: unknown = await response.json();
    if (!response.ok) {
      const error = ApiErrorSchema.safeParse(raw);
      throw new DeliveryClientError(
        response.status,
        error.success ? error.data.error.code : "HTTP_ERROR",
        error.success
          ? error.data.error.message
          : `Delivery request failed (${String(response.status)})`,
      );
    }
    return schema.parse(raw);
  };
}

/** `?key=value` for the defined entries, or an empty string. */
export function query(values: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined) params.set(key, value);
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}
