import type { Fetch } from "@shepherdjerred/ops-clients/http.ts";

export type RecordedRequest = {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
};

/**
 * A `fetch` double that answers each call from `respond` and records the
 * request, so tests can assert URLs, headers, and GraphQL variables.
 */
export function fakeFetch(
  respond: (request: RecordedRequest, index: number) => Response,
): { fetch: Fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchImpl: Fetch = (input, init) => {
    const body = init?.body;
    const request: RecordedRequest = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof body === "string" ? JSON.parse(body) : undefined,
    };
    requests.push(request);
    return Promise.resolve(respond(request, requests.length - 1));
  };
  return { fetch: fetchImpl, requests };
}

/** Answer calls in order with the given JSON bodies. */
export function sequence(...bodies: unknown[]): {
  fetch: Fetch;
  requests: RecordedRequest[];
} {
  return fakeFetch((_request, index) => {
    if (index >= bodies.length) {
      throw new Error(`Unexpected request #${String(index + 1)}`);
    }
    return Response.json(bodies[index]);
  });
}
