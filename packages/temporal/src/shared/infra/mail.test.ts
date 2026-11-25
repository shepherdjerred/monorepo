import { afterEach, describe, expect, it } from "vitest";
import {
  type MailConfig,
  readMailConfigFromEnv,
  sendMailEmail,
} from "./mail.ts";

const ORIGINAL_FETCH = globalThis.fetch;

const TEST_CONFIG: MailConfig = {
  baseUrl: "https://mail.example.com/",
  token: "test-token",
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
  return input instanceof URL ? input.toString() : input.url;
}

type FetchResponseSpec =
  | { kind: "json"; body: unknown; status?: number }
  | { kind: "text"; body: string; status: number };

function buildResponse(spec: FetchResponseSpec): Response {
  return spec.kind === "json"
    ? Response.json(spec.body, { status: spec.status ?? 202 })
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

describe("sendMailEmail", () => {
  it("posts to /v1/messages with Bearer auth and returns parsed message id", async () => {
    const captured = captureFetch({
      kind: "json",
      status: 202,
      body: {
        id: "msg-1",
        rfcMessageId: "<msg-1@example.com>",
        status: "queued",
        deduplicated: false,
      },
    });

    const result = await sendMailEmail(
      {
        to: "to@example.com",
        from: "from@example.com",
        subject: "hi",
        htmlBody: "<p>hi</p>",
        tag: "test",
        idempotencyKey: "run-1",
      },
      TEST_CONFIG,
    );

    expect(result).toEqual({
      messageId: "msg-1",
      recipientId: "unknown",
      subject: "hi",
      tag: "test",
    });

    expect(captured.calls).toHaveLength(1);
    const call = captured.calls[0];
    if (call === undefined) {
      throw new TypeError("expected exactly one fetch call");
    }
    expect(call.url).toBe("https://mail.example.com/v1/messages");
    expect(call.headers.get("Authorization")).toBe("Bearer test-token");
    expect(call.headers.get("Host")).toBeNull();
    if (call.body === undefined) {
      throw new TypeError("expected request body");
    }
    expect(JSON.parse(call.body)).toEqual({
      to: ["to@example.com"],
      from: "from@example.com",
      subject: "hi",
      htmlBody: "<p>hi</p>",
      tag: "test",
      idempotencyKey: "run-1",
    });
  });

  it("accepts 200 deduplicated responses", async () => {
    captureFetch({
      kind: "json",
      status: 200,
      body: {
        id: "msg-dedup",
        rfcMessageId: "<msg-dedup@example.com>",
        status: "sent",
        deduplicated: true,
      },
    });

    const result = await sendMailEmail(
      {
        to: "to@example.com",
        from: "from@example.com",
        subject: "hi",
        htmlBody: "<p>hi</p>",
        tag: "test",
        idempotencyKey: "run-dedup",
      },
      TEST_CONFIG,
    );

    expect(result.messageId).toBe("msg-dedup");
    expect(result.recipientId).toBe("unknown");
  });

  it("throws on non-2xx", async () => {
    captureFetch({ kind: "text", body: "oops", status: 500 });

    await expect(
      sendMailEmail(
        {
          to: "to@example.com",
          from: "from@example.com",
          subject: "hi",
          htmlBody: "<p>hi</p>",
          tag: "test",
        },
        TEST_CONFIG,
      ),
    ).rejects.toThrow(/Mail API error \(500\)/);
  });

  it("sends plainBody, messageId, and stable report headers when provided", async () => {
    const captured = captureFetch({
      kind: "json",
      body: {
        id: "msg-3",
        rfcMessageId: "<msg-3@example.com>",
        status: "queued",
        deduplicated: false,
      },
    });

    await sendMailEmail(
      {
        to: "to@example.com",
        from: "from@example.com",
        subject: "[OK] report",
        htmlBody: "<p>ok</p>",
        plainBody: "ok\n",
        messageId: "<report-run-1@sjer.red>",
        headers: { "X-Report-Run-ID": "report:run-1" },
        tag: "report",
      },
      TEST_CONFIG,
    );

    const call = captured.calls[0];
    if (call?.body === undefined) {
      throw new TypeError("expected request body");
    }
    expect(JSON.parse(call.body)).toMatchObject({
      plainBody: "ok\n",
      messageId: "<report-run-1@sjer.red>",
      headers: { "X-Report-Run-ID": "report:run-1" },
    });
  });

  it("handles RFC 5322 display-name senders with semantic @sjer.red recipients", async () => {
    const captured = captureFetch({
      kind: "json",
      body: {
        id: "msg-4",
        rfcMessageId: "<msg-4@sjer.red>",
        status: "queued",
        deduplicated: false,
      },
    });

    const result = await sendMailEmail(
      {
        to: "ops@sjer.red",
        from: "Homelab Audit <ops@sjer.red>",
        subject: "Homelab check: All clear",
        htmlBody: "<p>clear</p>",
        tag: "homelab-audit",
      },
      TEST_CONFIG,
    );

    expect(result.recipientId).toBe("unknown");
    const call = captured.calls[0];
    if (call?.body === undefined) {
      throw new TypeError("expected request body");
    }
    expect(JSON.parse(call.body)).toMatchObject({
      to: ["ops@sjer.red"],
      from: "Homelab Audit <ops@sjer.red>",
      subject: "Homelab check: All clear",
    });
  });

  it("requires MAIL_API_URL and MAIL_API_TOKEN from environment", () => {
    expect(() => readMailConfigFromEnv({})).toThrow(
      "Missing email configuration: MAIL_API_URL, MAIL_API_TOKEN",
    );
    expect(
      readMailConfigFromEnv({
        MAIL_API_URL: "http://mail.mail.svc:7371/",
        MAIL_API_TOKEN: "secret-token",
      }),
    ).toEqual({
      baseUrl: "http://mail.mail.svc:7371",
      token: "secret-token",
    });
  });
});
