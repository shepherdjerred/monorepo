import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { blueBubblesRequest } from "./client.ts";
beforeEach(() => {
  vi.stubEnv("BLUEBUBBLES_URL", "http://localhost:1234");
  vi.stubEnv("BLUEBUBBLES_PASSWORD", "test-secret-password");
});
afterEach(() => vi.unstubAllEnvs());
describe("BlueBubbles REST boundary", () => {
  test.each([
    "ftp://localhost:1234",
    "http://user:secret@localhost:1234",
    "http://localhost:1234?token=secret",
    "http://localhost:1234#fragment",
  ])("rejects invalid bootstrap URL %s without retrying", async (url) => {
    vi.stubEnv("BLUEBUBBLES_URL", url);
    await expect(
      blueBubblesRequest("/api/v1/message/query", {}, vi.fn<typeof fetch>()),
    ).rejects.toMatchObject({
      message: "Invalid BlueBubbles bootstrap URL",
      nonRetryable: true,
      type: "BlueBubblesConfigurationRejected",
    });
  });
  test("authenticates privately and parses a bounded API response", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ status: 200, data: [] }));
    expect(
      await blueBubblesRequest("/api/v1/message/query", {}, fetcher),
    ).toEqual([]);
    const url = fetcher.mock.calls[0]?.[0];
    expect(url).toBeInstanceOf(URL);
    if (!(url instanceof URL)) throw new Error("Expected parsed request URL");
    expect(url.searchParams.get("password")).toBe("test-secret-password");
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("manual");
  });
  test("does not retain token-bearing transport errors", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(
        new Error("http://localhost:1234?password=test-secret-password"),
      );
    await expect(
      blueBubblesRequest("/api/v1/message/query", {}, fetcher),
    ).rejects.toMatchObject({
      message:
        "BlueBubbles transport failed; check connection and server health",
    });
  });
  test("rejects oversized bodies", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("x".repeat(2 * 1024 * 1024 + 1)));
    await expect(
      blueBubblesRequest("/api/v1/message/query", {}, fetcher),
    ).rejects.toMatchObject({
      message: "BlueBubbles response exceeds the transfer limit",
      nonRetryable: true,
      type: "BlueBubblesResponseTooLarge",
    });
  });
  test("preserves the oversized classification when cleanup fails", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
      },
      cancel() {
        throw new Error("test-secret-password cleanup diagnostic");
      },
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
    await expect(
      blueBubblesRequest("/api/v1/message/query", {}, fetcher),
    ).rejects.toMatchObject({
      message: "BlueBubbles response exceeds the transfer limit",
      nonRetryable: true,
      type: "BlueBubblesResponseTooLarge",
    });
  });
  test("does not retain credential-bearing response stream errors", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(
          new Error("http://localhost:1234?password=test-secret-password"),
        );
      },
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
    await expect(
      blueBubblesRequest("/api/v1/message/query", {}, fetcher),
    ).rejects.toThrow(/^BlueBubbles response stream(?: cleanup)? failed$/);
  });
  test("does not copy invalid JSON containing server diagnostics", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("test-secret-password is not JSON"));
    await expect(
      blueBubblesRequest("/api/v1/message/query", {}, fetcher),
    ).rejects.toMatchObject({
      message: "BlueBubbles response is not valid JSON",
      nonRetryable: true,
      type: "BlueBubblesProtocolRejected",
    });
  });
  test("rejects malformed response envelopes without retrying", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: "missing status" }));
    await expect(
      blueBubblesRequest("/api/v1/message/query", {}, fetcher),
    ).rejects.toMatchObject({
      message: "BlueBubbles response envelope is invalid",
      nonRetryable: true,
      type: "BlueBubblesProtocolRejected",
    });
  });
  test.each([401, 404])(
    "fails permanent HTTP %s responses without retrying or copying diagnostics",
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("test-secret-password", { status }));
      await expect(
        blueBubblesRequest("/api/v1/message/query", {}, fetcher),
      ).rejects.toMatchObject({
        message: `BlueBubbles request failed with HTTP ${String(status)}`,
        nonRetryable: true,
        type: "BlueBubblesRequestRejected",
      });
    },
  );
  test.each([301, 302, 307, 308])(
    "rejects HTTP %s redirects without retrying",
    async (status) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(null, {
          status,
          headers: { location: "http://redirect.invalid/" },
        }),
      );
      await expect(
        blueBubblesRequest("/api/v1/message/query", {}, fetcher),
      ).rejects.toMatchObject({
        message: `BlueBubbles request failed with HTTP ${String(status)}`,
        nonRetryable: true,
        type: "BlueBubblesRequestRejected",
      });
    },
  );
  test("preserves permanent HTTP status when body cleanup fails", async () => {
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        throw new Error("test-secret-password cleanup diagnostic");
      },
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(body, { status: 401 }));
    await expect(
      blueBubblesRequest("/api/v1/message/query", {}, fetcher),
    ).rejects.toMatchObject({
      message: "BlueBubbles request failed with HTTP 401",
      nonRetryable: true,
      type: "BlueBubblesRequestRejected",
    });
  });
  test.each([429, 503])(
    "keeps transient HTTP %s responses retryable",
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("temporary failure", { status }));
      await expect(
        blueBubblesRequest("/api/v1/message/query", {}, fetcher),
      ).rejects.toEqual(
        new Error(`BlueBubbles request failed with HTTP ${String(status)}`),
      );
    },
  );
});
