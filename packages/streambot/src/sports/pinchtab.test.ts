import { afterEach, describe, expect, it, vi } from "vitest";
import { PinchtabSportsBrowser } from "@shepherdjerred/streambot/sports/pinchtab.ts";

describe("PinchtabSportsBrowser", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("discovers browser network requests without evaluation and closes the tab", async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    let captures = 0;
    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          input instanceof Request
            ? input.url
            : input instanceof URL
              ? input.toString()
              : input;
        requests.push({ url, init });
        if (url.endsWith("/instances")) {
          return Response.json({
            instances: [
              {
                id: "inst-streambot",
                profileName: "streambot",
                status: "running",
              },
            ],
          });
        }
        if (url.endsWith("/tabs/open")) {
          return Response.json({ id: "tab-stream" });
        }
        if (url.includes("/snapshot?interactive=true")) {
          return Response.json({
            nodes: [
              {
                ref: "e1",
                tag: "svg",
                frameUrl:
                  "https://streame.center/stream-east/hls.php?stream=test",
              },
            ],
          });
        }
        if (url.endsWith("/action")) {
          return Response.json({ success: true, result: { clicked: true } });
        }
        if (url.includes("/network?filter=m3u8")) {
          captures += 1;
          return Response.json({
            count: captures === 1 ? 1 : 2,
            entries:
              captures === 1
                ? [
                    {
                      url: "https://edgestream12.pro/expired.m3u8",
                      status: 404,
                    },
                  ]
                : [
                    {
                      url: "https://edgestream12.pro/expired.m3u8",
                      status: 404,
                    },
                    {
                      url: "https://edgestream12.pro/live.m3u8?token=secret",
                      status: 200,
                      requestHeaders: {
                        "User-Agent": "Chrome test user agent",
                        Origin: "https://streame.center",
                        Referer: "https://streame.center/stream-east/ch49.php",
                        Cookie: "do-not-forward-this-cookie",
                      },
                    },
                  ],
          });
        }
        return Response.json({ status: "ok" });
      },
    );

    const result = await new PinchtabSportsBrowser({
      baseUrl: "http://pinchtab.test",
      token: "test-token",
    }).runtimeStreams(
      "https://streame.center/stream-east/ch49.php",
      new AbortController().signal,
    );

    expect(result).toEqual({
      resources: ["https://edgestream12.pro/live.m3u8?token=secret"],
      headers: {
        "User-Agent": "Chrome test user agent",
        Origin: "https://streame.center",
        Referer: "https://streame.center/stream-east/ch49.php",
      },
    });
    expect(captures).toBe(2);
    expect(requests.some(({ url }) => url.endsWith("/evaluate"))).toBe(false);
    expect(
      requests.find(({ url }) => url.endsWith("/action"))?.init?.body,
    ).toBe(JSON.stringify({ kind: "click", ref: "e1" }));
    expect(
      requests.some(({ url }) => url.endsWith("/tabs/tab-stream/close")),
    ).toBe(true);
  });

  it("reads a signed HLS URL from the rendered nested player frame", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        requests.push(url);
        if (url.endsWith("/instances")) {
          return Response.json({
            instances: [
              {
                id: "inst-streambot",
                profileName: "streambot",
                status: "running",
              },
            ],
          });
        }
        if (url.endsWith("/tabs/open"))
          return Response.json({ id: "tab-frame" });
        if (url.includes("/network?filter=m3u8")) {
          return Response.json({ entries: [] });
        }
        if (url.includes("/snapshot?interactive=true")) {
          return Response.json({
            nodes: [
              {
                ref: "e0",
                tag: "iframe",
                childFrameUrl:
                  "https://streame.center/stream-east/hls.php?stream=channel",
              },
            ],
          });
        }
        if (
          url.endsWith("/frame") &&
          init?.body === JSON.stringify({ target: "e0" })
        ) {
          return Response.json({
            frame: {
              frameUrl:
                "https://streame.center/stream-east/hls.php?stream=channel",
            },
          });
        }
        if (url.endsWith("/html")) {
          return Response.json({
            html: `<script>var streamUrl = "https://edgestream12.pro/live.m3u8?token=secret";</script>`,
          });
        }
        if (url.includes("/network?filter=hls.php")) {
          return Response.json({
            entries: [
              {
                url: "https://streame.center/stream-east/hls.php?stream=channel",
                status: 200,
                requestHeaders: {
                  "User-Agent": "Chrome test user agent",
                  Referer: "https://streame.center/stream-east/ch49.php",
                },
              },
            ],
          });
        }
        return Response.json({ status: "ok" });
      },
    );

    const result = await new PinchtabSportsBrowser({
      baseUrl: "http://pinchtab.test",
      token: "test-token",
    }).runtimeStreams(
      "https://streame.center/stream-east/ch49.php",
      new AbortController().signal,
    );

    expect(result).toEqual({
      resources: ["https://edgestream12.pro/live.m3u8?token=secret"],
      headers: {
        "User-Agent": "Chrome test user agent",
        Referer: "https://streame.center/stream-east/ch49.php",
      },
    });
    expect(requests.some((url) => url.endsWith("/action"))).toBe(false);
    expect(requests.some((url) => url.endsWith("/tabs/tab-frame/close"))).toBe(
      true,
    );
  });
});
