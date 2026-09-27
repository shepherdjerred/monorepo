import { afterEach, describe, expect, it, vi } from "vitest";
import { PinchtabSportsBrowser } from "@shepherdjerred/streambot/sports/pinchtab.ts";

function sessionResponse(url: string, tabId: string): Response | null {
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
  return url.endsWith("/tabs/open") ? Response.json({ id: tabId }) : null;
}

function testBrowser(): PinchtabSportsBrowser {
  return new PinchtabSportsBrowser({
    baseUrl: "http://pinchtab.test",
    token: "test-token",
  });
}

async function testRuntimeStreams() {
  return await testBrowser().runtimeStreams(
    "https://streame.center/stream-east/ch49.php",
    new AbortController().signal,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("PinchtabSportsBrowser streams", () => {
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
        const session = sessionResponse(url, "tab-stream");
        if (session !== null) return session;
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

    const result = await testRuntimeStreams();

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
        const session = sessionResponse(url, "tab-frame");
        if (session !== null) return session;
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

    const result = await testRuntimeStreams();

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

describe("PinchtabSportsBrowser TvSportsLive player", () => {
  it("plays a TvSportsLive embed and captures its browser HLS request", async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    let captures = 0;
    vi.stubGlobal(
      "fetch",
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        requests.push({ url, init });
        const session = sessionResponse(url, "tab-tv");
        if (session !== null) return session;
        if (url.includes("/network?filter=m3u8")) {
          captures += 1;
          return Response.json({
            entries:
              captures === 1
                ? []
                : [
                    {
                      url: "https://lb16.strmd.st/secure/live/mono.m3u8",
                      status: 200,
                      requestHeaders: {
                        Referer: "https://embed.st/",
                        "User-Agent": "Chrome test user agent",
                      },
                    },
                  ],
          });
        }
        if (url.includes("/snapshot?interactive=true")) {
          return Response.json({
            nodes: [
              {
                ref: "e1",
                role: "button",
                name: "Play",
                tag: "div",
                frameUrl:
                  "https://embed.st/embed/admin/ppv-baltimore-ravens-at-dallas-cowboys/1",
              },
            ],
          });
        }
        return url.endsWith("/action")
          ? Response.json({ success: true, result: { clicked: true } })
          : Response.json({ status: "ok" });
      },
    );

    const result = await testBrowser().runtimeStreams(
      "https://embed.st/embed/admin/ppv-baltimore-ravens-at-dallas-cowboys/1",
      new AbortController().signal,
    );

    expect(result).toEqual({
      resources: ["https://lb16.strmd.st/secure/live/mono.m3u8"],
      headers: {
        Referer: "https://embed.st/",
        "User-Agent": "Chrome test user agent",
      },
    });
    expect(
      requests.find(({ url }) => url.endsWith("/action"))?.init?.body,
    ).toBe(JSON.stringify({ kind: "click", ref: "e1" }));
    expect(requests.some(({ url }) => url.endsWith("/tabs/tab-tv/close"))).toBe(
      true,
    );
  });

  it("rejects unapproved TvSportsLive player paths", async () => {
    await expect(
      testBrowser().runtimeStreams(
        "https://embed.st/redirect?url=https://private.invalid/",
        new AbortController().signal,
      ),
    ).rejects.toThrow("approved HTTPS source");
  });
});

describe("PinchtabSportsBrowser lifecycle", () => {
  it("waits for an automatic TvSportsLive browser check to clear", async () => {
    let htmlReads = 0;
    vi.stubGlobal("fetch", (input: string) => {
      const session = sessionResponse(input, "tab-challenge");
      if (session !== null) return session;
      if (input.endsWith("/html")) {
        htmlReads += 1;
        return Response.json({
          html:
            htmlReads === 1
              ? "<title>Just a moment...</title>"
              : "<title>TvSportsLive</title>",
        });
      }
      return Response.json({ closed: true });
    });

    expect(
      await testBrowser().html(
        "https://tvsportslive.fr/",
        new AbortController().signal,
      ),
    ).toBe("<title>TvSportsLive</title>");
    expect(htmlReads).toBe(2);
  });

  it("creates its dedicated profile before starting a fresh browser", async () => {
    const requests: {
      url: string;
      method: string;
      body: RequestInit["body"] | null;
    }[] = [];
    let instanceLookups = 0;
    vi.stubGlobal("fetch", (input: string, init?: RequestInit) => {
      requests.push({
        url: input,
        method: init?.method ?? "GET",
        body: init?.body ?? null,
      });
      if (input.endsWith("/instances")) {
        instanceLookups += 1;
        return Response.json(
          instanceLookups === 1
            ? []
            : [
                {
                  id: "inst-new",
                  profileName: "streambot",
                  status: instanceLookups === 2 ? "starting" : "running",
                },
              ],
        );
      }
      if (input.endsWith("/profiles") && init?.method === undefined)
        return Response.json([]);
      if (input.endsWith("/profiles") && init?.method === "POST") {
        return Response.json({ id: "prof-streambot", name: "streambot" });
      }
      if (input.endsWith("/profiles/prof-streambot/start")) {
        return Response.json({ instanceId: "inst-new" });
      }
      if (input.endsWith("/instances/inst-new/tabs/open")) {
        return Response.json({ tabId: "tab-new" });
      }
      return input.endsWith("/tabs/tab-new/html")
        ? Response.json({ html: "<title>Ready</title>" })
        : Response.json({ closed: true });
    });

    const browser = testBrowser();
    expect(
      await browser.html(
        "https://v2.streameast.ga/",
        new AbortController().signal,
      ),
    ).toBe("<title>Ready</title>");
    expect(requests.map((request) => request.url)).toEqual([
      "http://pinchtab.test/instances",
      "http://pinchtab.test/profiles",
      "http://pinchtab.test/profiles",
      "http://pinchtab.test/profiles/prof-streambot/start",
      "http://pinchtab.test/instances",
      "http://pinchtab.test/instances",
      "http://pinchtab.test/instances/inst-new/tabs/open",
      "http://pinchtab.test/tabs/tab-new/html",
      "http://pinchtab.test/tabs/tab-new/close",
    ]);
    expect(requests[2]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ name: "streambot" }),
    });
  });

  it("replaces a stale instance after PinchTab restarts", async () => {
    const requests: string[] = [];
    let instanceLookups = 0;
    let oldInstanceOpens = 0;
    vi.stubGlobal("fetch", (input: string) => {
      requests.push(input);
      if (input.endsWith("/instances")) {
        instanceLookups += 1;
        return Response.json(
          instanceLookups === 1
            ? [{ id: "inst-old", profileName: "streambot", status: "running" }]
            : instanceLookups === 2
              ? []
              : [
                  {
                    id: "inst-new",
                    profileName: "streambot",
                    status: "running",
                  },
                ],
        );
      }
      if (input.endsWith("/instances/inst-old/tabs/open")) {
        oldInstanceOpens += 1;
        return oldInstanceOpens === 1
          ? Response.json({ tabId: "tab-old" })
          : new Response(null, { status: 404 });
      }
      if (input.endsWith("/profiles")) {
        return Response.json([{ id: "prof-streambot", name: "streambot" }]);
      }
      if (input.endsWith("/profiles/prof-streambot/start")) {
        return Response.json({ instanceId: "inst-new" });
      }
      if (input.endsWith("/instances/inst-new/tabs/open")) {
        return Response.json({ tabId: "tab-new" });
      }
      return input.endsWith("/html")
        ? Response.json({ html: "<title>Ready</title>" })
        : Response.json({ closed: true });
    });

    const browser = testBrowser();
    const signal = new AbortController().signal;
    await browser.html("https://v2.streameast.ga/", signal);
    expect(await browser.html("https://v2.streameast.ga/", signal)).toBe(
      "<title>Ready</title>",
    );
    expect(instanceLookups).toBe(3);
    expect(oldInstanceOpens).toBe(2);
    expect(requests).toContain(
      "http://pinchtab.test/instances/inst-new/tabs/open",
    );
    expect(requests.filter((url) => url.endsWith("/profiles"))).toHaveLength(1);
  });
});
