import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareLoaderHls } from "./loader-hls.ts";
import { sportsPng } from "#sports-png-fixture";

afterEach(() => vi.unstubAllGlobals());
const page = "https://v2.streameast.ga/nba/synthetic-game/3";
const html =
  '<script>var _seEsBoot = {"t":"synthetic-ticket","hs":"https://hs.embedse.com/v/hs"};</script>';

describe("native loader HLS relay", () => {
  it("unwraps media, rejects arbitrary routes and releases its listener", async () => {
    const originalFetch = fetch;
    const bytes = new Uint8Array([71, 0, 1, 2]);
    vi.stubGlobal("fetch", async (url: string | URL, options?: RequestInit) => {
      const target = String(url);
      if (target.endsWith("/v/hs")) {
        expect(options?.headers).toMatchObject({
          "User-Agent": "actual-browser",
        });
        if (typeof options?.body !== "string")
          throw new TypeError("Missing handshake body");
        expect(JSON.parse(options.body)).toEqual({
          mt: "synthetic-ticket",
          q: 1,
        });
        return Response.json({
          ok: true,
          q: "https://hs.embedse.com/q/synthetic/index.m3u8",
        });
      }
      return target.endsWith(".m3u8")
        ? new Response(
            "#EXTM3U\n#EXTINF:2,\nhttps://p16-common-sign.tiktokcdn.com/synthetic.image\n",
          )
        : new Response(sportsPng(bytes));
    });
    const prepared = await prepareLoaderHls(
      html,
      page,
      new AbortController().signal,
      { headers: { "User-Agent": "actual-browser" } },
    );
    expect(prepared).not.toBeNull();
    if (prepared === null) throw new Error("Missing test preparation");
    try {
      const playlist = await originalFetch(prepared.input).then((response) =>
        response.text(),
      );
      const segment = playlist.split("\n").find((line) => line.startsWith("/"));
      if (segment === undefined) throw new Error("Missing test segment");
      const segmentResponse = await originalFetch(
        new URL(segment, prepared.input),
      );
      const segmentBytes = await segmentResponse.arrayBuffer();
      expect(new Uint8Array(segmentBytes)).toEqual(bytes);
      const arbitrary = await originalFetch(
        new URL("/arbitrary", prepared.input),
      );
      expect(arbitrary.status).toBe(404);
    } finally {
      await prepared.close();
    }
    await expect(originalFetch(prepared.input)).rejects.toThrow();
    await prepared.close();
  });

  it("keeps the initial playlist usable after thousands of sliding-window refreshes", async () => {
    const originalFetch = fetch;
    let sequence = 0;
    vi.stubGlobal("fetch", async (url: string | URL) =>
      String(url).endsWith("/v/hs")
        ? Response.json({
            ok: true,
            q: "https://hs.embedse.com/q/synthetic/index.m3u8",
          })
        : new Response(
            `#EXTM3U\n#EXTINF:2,\nhttps://p16-common-sign.tiktokcdn.com/${String(sequence++)}.image\n`,
          ),
    );
    const prepared = await prepareLoaderHls(
      html,
      page,
      new AbortController().signal,
    );
    if (prepared === null) throw new Error("Missing test preparation");
    try {
      for (let index = 0; index < 2100; index++) {
        const response = await originalFetch(prepared.input);
        expect(response.status).toBe(200);
        await response.arrayBuffer();
      }
      expect(sequence).toBe(2100);
    } finally {
      await prepared.close();
    }
  });

  it("rejects private upstream URLs and reports the bounded failure to its owner", async () => {
    const originalFetch = fetch;
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (url: string | URL) => {
      requests.push(String(url));
      return String(url).endsWith("/v/hs")
        ? Response.json({
            ok: true,
            q: "https://hs.embedse.com/q/synthetic/index.m3u8",
          })
        : new Response("#EXTM3U\n#EXTINF:2,\nhttp://127.0.0.1/private\n");
    });
    const prepared = await prepareLoaderHls(
      html,
      page,
      new AbortController().signal,
    );
    if (prepared === null) throw new Error("Missing test preparation");
    try {
      const response = await originalFetch(prepared.input);
      expect(response.status).toBe(502);
      await expect(prepared.failure).rejects.toMatchObject({
        kind: "unsupported-format",
      });
      expect(requests).toHaveLength(2);
      const firstClose = prepared.close();
      expect(prepared.close()).toBe(firstClose);
      await firstClose;
    } finally {
      await prepared.close();
    }
  });
});
