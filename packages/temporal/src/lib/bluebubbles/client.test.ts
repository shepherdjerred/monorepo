import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { blueBubblesRequest } from "./client.ts";
beforeEach(() => {
  vi.stubEnv("BLUEBUBBLES_URL", "http://localhost:1234");
  vi.stubEnv("BLUEBUBBLES_PASSWORD", "test-secret-password");
});
afterEach(() => vi.unstubAllEnvs());
describe("BlueBubbles REST boundary", () => {
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
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("error");
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
    ).rejects.toThrow("transfer limit");
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
    ).rejects.toThrow("BlueBubbles response is not valid JSON");
  });
  test("reports HTTP status without copying the server's diagnostic body", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("test-secret-password", { status: 401 }));
    await expect(
      blueBubblesRequest("/api/v1/message/query", {}, fetcher),
    ).rejects.toThrow("HTTP 401");
  });
});
