import { describe, expect, it, vi } from "vitest";
import { readSportsMediaPage } from "./media-page.ts";

const url = "https://v2.streameast.ga/nba/fixture/";
function client(headers?: Record<string, string>) {
  const requestHeaders = headers ?? {
    "User-Agent": "browser",
    Cookie: "private-cookie",
  };
  return {
    open: vi.fn(async () => ({ tabId: "owned-tab" })),
    close: vi.fn(() => Promise.resolve()),
    json: vi.fn(async (path: string) =>
      path.endsWith("/html")
        ? { html: "<title>Fixture</title>" }
        : { entries: [{ url, status: 200, requestHeaders }] },
    ),
  };
}
describe("media document identity", () => {
  it("preserves its browser identity and closes the tab without exporting cookies", async () => {
    const c = client();
    const result = await readSportsMediaPage(
      url,
      new AbortController().signal,
      c,
    );
    expect(result.headers["User-Agent"]).toBe("browser");
    expect(result.headers["Cookie"]).toBeUndefined();
    expect(c.close).toHaveBeenCalledWith("owned-tab");
  });
  it("closes on a missing required browser identity", async () => {
    const c = client({});
    await expect(
      readSportsMediaPage(url, new AbortController().signal, c),
    ).rejects.toThrow("User-Agent");
    expect(c.close).toHaveBeenCalledOnce();
  });
  it("does not open a tab after cancellation", async () => {
    const c = client();
    await expect(
      readSportsMediaPage(url, AbortSignal.abort(new Error("cancelled")), c),
    ).rejects.toThrow("cancelled");
    expect(c.open).not.toHaveBeenCalled();
  });
});
