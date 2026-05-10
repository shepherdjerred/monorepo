import { afterEach, describe, expect, it } from "bun:test";
import { type PostalConfig, sendPostalEmail } from "./postal.ts";

const ORIGINAL_FETCH = globalThis.fetch;

const TEST_CONFIG: PostalConfig = {
  host: "https://postal.example.com",
  apiKey: "test-key",
};

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

type CapturedCall = {
  url: string;
  body: string | undefined;
  headers: Headers;
};

function urlToString(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

/**
 * Replace `globalThis.fetch` with a mock that records the call's url, body,
 * and headers in a typed shape so test assertions don't widen through
 * `any` / `as unknown as` to inspect mock.calls. Mirrors the pattern from
 * `golink-sync.test.ts` (Object.assign onto a typed handler).
 */
type FetchResponseSpec =
  | { kind: "json"; body: unknown; status?: number }
  | { kind: "text"; body: string; status: number };

function buildResponse(spec: FetchResponseSpec): Response {
  return spec.kind === "json"
    ? Response.json(spec.body, { status: spec.status ?? 200 })
    : new Response(spec.body, { status: spec.status });
}

function captureFetch(spec: FetchResponseSpec): { calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const handler = async (url: string | URL | Request, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : undefined;
    const headers = new Headers(init?.headers);
    calls.push({ url: urlToString(url), body, headers });
    return buildResponse(spec);
  };
  globalThis.fetch = Object.assign(handler, {
    preconnect: ORIGINAL_FETCH.preconnect,
  });
  return { calls };
}

describe("sendPostalEmail", () => {
  it("returns the parsed message id and recipient id on success", async () => {
    const captured = captureFetch({
      kind: "json",
      body: {
        status: "success",
        data: {
          message_id: "msg-1",
          messages: { "to@example.com": { id: 42, token: "t" } },
        },
      },
    });

    const result = await sendPostalEmail(
      {
        to: "to@example.com",
        from: "from@example.com",
        subject: "hi",
        htmlBody: "<p>hi</p>",
        tag: "test",
      },
      TEST_CONFIG,
    );

    expect(result.messageId).toBe("msg-1");
    expect(result.recipientId).toBe(42);
    expect(result.tag).toBe("test");

    expect(captured.calls).toHaveLength(1);
    const call = captured.calls[0];
    if (call === undefined) {
      throw new TypeError("expected exactly one fetch call");
    }
    expect(call.url).toBe("https://postal.example.com/api/v1/send/message");
    if (call.body === undefined) {
      throw new TypeError("expected request body");
    }
    const body: unknown = JSON.parse(call.body);
    expect(body).toEqual({
      to: ["to@example.com"],
      from: "from@example.com",
      subject: "hi",
      html_body: "<p>hi</p>",
      tag: "test",
    });
  });

  it("throws when Postal returns 200 but envelope status is not success", async () => {
    captureFetch({
      kind: "json",
      body: { status: "parameter-error", data: { message: "bad" } },
    });

    await expect(
      sendPostalEmail(
        {
          to: "to@example.com",
          from: "from@example.com",
          subject: "hi",
          htmlBody: "<p>hi</p>",
          tag: "test",
        },
        TEST_CONFIG,
      ),
    ).rejects.toThrow(/Postal rejected message \(status=parameter-error\)/);
  });

  it("throws on non-2xx", async () => {
    captureFetch({ kind: "text", body: "oops", status: 500 });

    await expect(
      sendPostalEmail(
        {
          to: "to@example.com",
          from: "from@example.com",
          subject: "hi",
          htmlBody: "<p>hi</p>",
          tag: "test",
        },
        TEST_CONFIG,
      ),
    ).rejects.toThrow(/Postal API error \(500\)/);
  });

  it("includes the optional Host header when config.hostHeader is set", async () => {
    const captured = captureFetch({
      kind: "json",
      body: {
        status: "success",
        data: {
          message_id: "msg-2",
          messages: { "to@example.com": { id: 7, token: "t" } },
        },
      },
    });

    await sendPostalEmail(
      {
        to: "to@example.com",
        from: "from@example.com",
        subject: "hi",
        htmlBody: "<p>hi</p>",
        tag: "test",
      },
      { ...TEST_CONFIG, hostHeader: "postal.internal" },
    );

    const call = captured.calls[0];
    if (call === undefined) {
      throw new TypeError("expected exactly one fetch call");
    }
    expect(call.headers.get("Host")).toBe("postal.internal");
  });
});
