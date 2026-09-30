import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchSafePublicText } from "@shepherdjerred/birmel/utils/safe-fetch.ts";

const PUBLIC_RESOLVER = async () => [{ address: "93.184.216.34", family: 4 }];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchSafePublicText", () => {
  test("rejects non-HTTPS and private destinations before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSafePublicText("http://example.com")).rejects.toThrow(
      "only HTTPS is allowed",
    );
    await expect(
      fetchSafePublicText("https://127.0.0.1/private"),
    ).rejects.toThrow("private or reserved");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("pins public DNS and validates every redirect", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://127.0.0.1/private" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchSafePublicText(
        "https://example.com/start",
        undefined,
        PUBLIC_RESOLVER,
      ),
    ).rejects.toThrow("private or reserved");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("93.184.216.34");
  });

  test("returns bounded text content without exposing the pinned URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("hello", {
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
      ),
    );

    await expect(
      fetchSafePublicText(
        "https://example.com/article",
        undefined,
        PUBLIC_RESOLVER,
      ),
    ).resolves.toEqual({
      url: "https://example.com/article",
      contentType: "text/plain; charset=utf-8",
      text: "hello",
    });
  });
});
