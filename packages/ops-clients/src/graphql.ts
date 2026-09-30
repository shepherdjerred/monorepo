import { z } from "zod";
import {
  fetchJson,
  UpstreamError,
  type Fetch,
} from "@shepherdjerred/ops-clients/http.ts";

export type GraphqlRequest = {
  upstream: string;
  url: string;
  headers: Record<string, string>;
  query: string;
  variables?: Record<string, unknown>;
  signal?: AbortSignal;
};

/**
 * POST one GraphQL operation and validate its `data`. GraphQL servers answer
 * 200 with an `errors` array for query and permission failures, so a present
 * `errors` array is an upstream failure even when some `data` came back.
 */
export async function postGraphql<T extends z.ZodType>(
  fetchImpl: Fetch,
  request: GraphqlRequest,
  dataSchema: T,
): Promise<z.infer<T>> {
  const envelope = z.object({
    data: dataSchema.nullable().optional(),
    errors: z.array(z.object({ message: z.string() }).loose()).optional(),
  });
  const body = await fetchJson(
    fetchImpl,
    {
      upstream: request.upstream,
      url: request.url,
      init: {
        method: "POST",
        headers: { "content-type": "application/json", ...request.headers },
        body: JSON.stringify({
          query: request.query,
          variables: request.variables ?? {},
        }),
      },
      ...(request.signal ? { signal: request.signal } : {}),
    },
    envelope,
  );
  if (body.errors !== undefined && body.errors.length > 0) {
    // GraphQL error messages describe the query, not the payload; keep one.
    const first = body.errors[0]?.message.slice(0, 200) ?? "unknown error";
    throw new UpstreamError(
      request.upstream,
      `GraphQL error (${String(body.errors.length)}): ${first}`,
    );
  }
  if (body.data === undefined || body.data === null) {
    throw new UpstreamError(request.upstream, "GraphQL response had no data");
  }
  return body.data;
}
