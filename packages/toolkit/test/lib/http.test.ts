import { afterEach, describe, expect, it } from "bun:test";
import { z } from "zod";
import { createHttpClient } from "#lib/http.ts";

const ORIGINAL_FETCH = globalThis.fetch;

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

type CapturedRequest = {
  url: string;
  init: FetchInit;
};

/**
 * Install a fetch mock that records each request and returns `response`. The
 * captured requests let tests assert on the built URL and headers without a
 * real network call (dependency-injected via the global `fetch`).
 */
function installFetchMock(response: Response | (() => Response)): {
  requests: CapturedRequest[];
} {
  const requests: CapturedRequest[] = [];
  const fetchMock: typeof fetch = Object.assign(
    async (input: FetchInput, init?: FetchInit) => {
      requests.push({ url: fetchInputToUrl(input), init });
      return typeof response === "function" ? response() : response;
    },
    { preconnect: ORIGINAL_FETCH.preconnect },
  );
  globalThis.fetch = fetchMock;
  return { requests };
}

function fetchInputToUrl(input: FetchInput): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function headerValue(init: FetchInit, name: string): string | undefined {
  const headers = init?.headers;
  if (headers == null || Array.isArray(headers) || headers instanceof Headers) {
    return undefined;
  }
  const value = headers[name];
  return typeof value === "string" ? value : undefined;
}

const BodySchema = z.object({ value: z.number() });

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("createHttpClient query building", () => {
  it("sets scalar params and appends array params once per element", async () => {
    const { requests } = installFetchMock(Response.json({ value: 1 }));
    const client = createHttpClient({
      baseUrl: "https://api.example.test",
      auth: { scheme: "Bearer", token: "t" },
      errorLabel: "Example API",
    });

    await client.get("/items", {
      schema: BodySchema,
      query: { status: "open", tag: ["a", "b"] },
    });

    const url = new URL(requests[0]!.url);
    expect(url.pathname).toBe("/items");
    expect(url.searchParams.get("status")).toBe("open");
    expect(url.searchParams.getAll("tag")).toEqual(["a", "b"]);
  });

  it("omits the query string when no params are given", async () => {
    const { requests } = installFetchMock(Response.json({ value: 1 }));
    const client = createHttpClient({
      baseUrl: "https://api.example.test",
      auth: { scheme: "Bearer", token: "t" },
      errorLabel: "Example API",
    });

    await client.get("/items", { schema: BodySchema });

    expect(requests[0]!.url).toBe("https://api.example.test/items");
  });

  it("routes the URL through the normalizeUrl hook when provided", async () => {
    const { requests } = installFetchMock(Response.json({ value: 1 }));
    const client = createHttpClient({
      baseUrl: "https://api.example.test",
      auth: { scheme: "Bearer", token: "t" },
      errorLabel: "Example API",
      normalizeUrl: (base, endpoint) => new URL(`${base}/api/v1${endpoint}`),
    });

    await client.get("/items", {
      schema: BodySchema,
      query: { q: "x" },
    });

    const url = new URL(requests[0]!.url);
    expect(url.pathname).toBe("/api/v1/items");
    expect(url.searchParams.get("q")).toBe("x");
  });
});

describe("createHttpClient auth headers", () => {
  it("writes a Bearer authorization header", async () => {
    const { requests } = installFetchMock(Response.json({ value: 1 }));
    const client = createHttpClient({
      baseUrl: "https://api.example.test",
      auth: { scheme: "Bearer", token: "secret" },
      errorLabel: "Example API",
    });

    await client.get("/items", { schema: BodySchema });

    expect(headerValue(requests[0]!.init, "Authorization")).toBe(
      "Bearer secret",
    );
    expect(headerValue(requests[0]!.init, "Content-Type")).toBe(
      "application/json",
    );
  });

  it("writes a Token token= authorization header and merges extra headers", async () => {
    const { requests } = installFetchMock(Response.json({ value: 1 }));
    const client = createHttpClient({
      baseUrl: "https://api.example.test",
      auth: { scheme: "Token token=", token: "abc" },
      errorLabel: "Example API",
      headers: { Accept: "application/vnd.example+json;version=2" },
    });

    await client.get("/items", { schema: BodySchema });

    expect(headerValue(requests[0]!.init, "Authorization")).toBe(
      "Token token=abc",
    );
    expect(headerValue(requests[0]!.init, "Accept")).toBe(
      "application/vnd.example+json;version=2",
    );
  });
});

describe("createHttpClient parsing and errors", () => {
  it("parses a successful JSON body with the schema", async () => {
    installFetchMock(Response.json({ value: 42 }));
    const client = createHttpClient({
      baseUrl: "https://api.example.test",
      auth: { scheme: "Bearer", token: "t" },
      errorLabel: "Example API",
    });

    const result = await client.get("/items", { schema: BodySchema });

    expect(result).toEqual({ success: true, data: { value: 42 } });
  });

  it("wraps a non-2xx response with the error label, status, and body", async () => {
    installFetchMock(new Response("boom", { status: 503 }));
    const client = createHttpClient({
      baseUrl: "https://api.example.test",
      auth: { scheme: "Bearer", token: "t" },
      errorLabel: "Example API",
    });

    const result = await client.get("/items", { schema: BodySchema });

    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.error).toBe("Example API error (503): boom");
  });

  it("falls back to an error envelope when the body is not JSON", async () => {
    installFetchMock(new Response("not json", { status: 200 }));
    const client = createHttpClient({
      baseUrl: "https://api.example.test",
      auth: { scheme: "Bearer", token: "t" },
      errorLabel: "Example API",
    });

    const result = await client.get("/items", { schema: BodySchema });

    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
    expect(typeof result.error).toBe("string");
  });

  it("falls back to an error envelope when the schema does not match", async () => {
    installFetchMock(Response.json({ value: "not a number" }));
    const client = createHttpClient({
      baseUrl: "https://api.example.test",
      auth: { scheme: "Bearer", token: "t" },
      errorLabel: "Example API",
    });

    const result = await client.get("/items", { schema: BodySchema });

    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
    expect(typeof result.error).toBe("string");
  });

  it("wraps a thrown options-factory error into the failure envelope instead of rejecting", async () => {
    const client = createHttpClient(() => {
      throw new Error("MISSING_TOKEN environment variable is not set");
    });

    const result = await client.get("/items", { schema: BodySchema });

    expect(result).toEqual({
      success: false,
      error: "MISSING_TOKEN environment variable is not set",
    });
  });

  it("wraps a thrown network error into the failure envelope", async () => {
    const fetchMock: typeof fetch = Object.assign(
      async () => {
        throw new Error("network down");
      },
      { preconnect: ORIGINAL_FETCH.preconnect },
    );
    globalThis.fetch = fetchMock;
    const client = createHttpClient({
      baseUrl: "https://api.example.test",
      auth: { scheme: "Bearer", token: "t" },
      errorLabel: "Example API",
    });

    const result = await client.get("/items", { schema: BodySchema });

    expect(result).toEqual({ success: false, error: "network down" });
  });
});

describe("createHttpClient post and raw", () => {
  it("POSTs a JSON body and parses the response", async () => {
    const { requests } = installFetchMock(Response.json({ value: 7 }));
    const client = createHttpClient({
      baseUrl: "https://api.example.test",
      auth: { scheme: "Bearer", token: "t" },
      errorLabel: "Example API",
    });

    const result = await client.post("/items", {
      schema: BodySchema,
      body: { name: "widget" },
    });

    expect(result).toEqual({ success: true, data: { value: 7 } });
    expect(requests[0]!.init?.method).toBe("POST");
    expect(requests[0]!.init?.body).toBe(JSON.stringify({ name: "widget" }));
  });

  it("returns raw text without JSON parsing", async () => {
    installFetchMock(new Response("plain body", { status: 200 }));
    const client = createHttpClient({
      baseUrl: "https://api.example.test",
      auth: { scheme: "Bearer", token: "t" },
      errorLabel: "Example API",
    });

    const result = await client.raw("/logs");

    expect(result).toEqual({ success: true, data: "plain body" });
  });

  it("omits Content-Type on raw requests", async () => {
    const { requests } = installFetchMock(new Response("x", { status: 200 }));
    const client = createHttpClient({
      baseUrl: "https://api.example.test",
      auth: { scheme: "Bearer", token: "t" },
      errorLabel: "Example API",
    });

    await client.raw("/logs");

    expect(headerValue(requests[0]!.init, "Content-Type")).toBeUndefined();
    expect(headerValue(requests[0]!.init, "Authorization")).toBe("Bearer t");
  });
});
