import { describe, expect, it } from "vitest";
import {
  decodeClearKeyBootstrap,
  prepareClearKey,
  splitClearKeyManifest,
  stripClearKeyHlsTags,
} from "./clearkey.ts";
import { createDashResourceRegistry } from "./clearkey-dash-resources.ts";

const videoId = "11111111111111111111111111111111";
const audioId = "22222222222222222222222222222222";
const videoKey = Array.from({ length: 32 }, (_, index) =>
  (index % 16).toString(16),
).join("");
const audioKey = Array.from({ length: 32 }, (_, index) =>
  (15 - (index % 16)).toString(16),
).join("");
const keys = { [videoId]: videoKey, [audioId]: audioKey };
const manifestUrl = "https://u.steast.io/fixture/manifest.mpd";
const xml = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" xmlns:cenc="urn:mpeg:cenc:2013"><Period><AdaptationSet contentType="video"><ContentProtection cenc:default_KID="${videoId}"/><Representation id="video" mimeType="video/mp4"><SegmentTemplate initialization="video-init.mp4" media="video-$Number$.m4s"/></Representation></AdaptationSet><AdaptationSet contentType="audio"><ContentProtection cenc:default_KID="${audioId}"/><Representation id="audio" mimeType="audio/mp4"><SegmentTemplate initialization="audio-init.mp4" media="audio-$Number$.m4s"/></Representation></AdaptationSet></Period></MPD>`;

async function envelope(ticket: string) {
  const n = "synthetic-nonce";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`ck|${ticket}|${n}`),
  );
  const key = await crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
  ]);
  const iv = new Uint8Array(12).fill(7);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify({ m: manifestUrl, k: keys })),
  );
  const bytes = new Uint8Array(iv.length + cipher.byteLength);
  bytes.set(iv);
  bytes.set(new Uint8Array(cipher), iv.length);
  return { ok: true, n, p: btoa(String.fromCodePoint(...bytes)) };
}

describe("ClearKey media preparation", () => {
  it("normalizes CENC HLS key signaling without treating unrelated encryption as CENC", () => {
    expect(
      stripClearKeyHlsTags(
        '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES-CTR,URI="private"\nsegment.m4s',
      ),
    ).toBe("#EXTM3U\nsegment.m4s");
    expect(() =>
      stripClearKeyHlsTags('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"'),
    ).toThrow();
  });
  it("rewrites DASH templates to a closed resource registry", () => {
    const registry = createDashResourceRegistry(
      "/fixture/resource/",
      (value) => {
        const url = new URL(value);
        if (url.origin !== "https://u.steast.io")
          throw new Error("Unexpected fixture origin");
        return url;
      },
    );
    const rewritten = registry.rewrite(
      splitClearKeyManifest(xml, manifestUrl, keys).video.xml,
      manifestUrl,
    );
    expect(rewritten).not.toContain("https://u.steast.io");
    const path = /media="([^"]+)"/.exec(rewritten)?.[1];
    if (path === undefined) throw new Error("Fixture media template missing");
    expect(registry.resolve(path.replace("$Number$", "3"))?.href).toBe(
      "https://u.steast.io/fixture/video-3.m4s",
    );
    expect(registry.resolve("/fixture/resource/unknown/3.m4s")).toBeNull();
    registry.clear();
    expect(registry.resolve(path.replace("$Number$", "3"))).toBeNull();
  });
  it("preserves escaped query parameters while rewriting DASH resources", () => {
    const registry = createDashResourceRegistry(
      "/fixture/",
      (value) => new URL(value),
    );
    const result = registry.rewrite(
      xml.replace(
        'media="video-$Number$.m4s"',
        'media="video-$Number$.m4s?a=1&amp;b=2"',
      ),
      manifestUrl,
    );
    const reference = /media="([^"]+)"/.exec(result)?.[1];
    if (reference === undefined) throw new Error("Media template missing");
    expect(registry.resolve(reference.replace("$Number$", "3"))?.search).toBe(
      "?a=1&b=2",
    );
  });
  it("decodes the authenticated synthetic bootstrap envelope", async () => {
    expect(
      await decodeClearKeyBootstrap(
        "fixture-ticket",
        await envelope("fixture-ticket"),
      ),
    ).toEqual({ m: manifestUrl, k: keys });
    await expect(
      decodeClearKeyBootstrap("wrong-ticket", await envelope("fixture-ticket")),
    ).rejects.toThrow();
  });
  it("creates track views with independent keys and absolute resource base", () => {
    const result = splitClearKeyManifest(xml, manifestUrl, keys);
    expect(result.video.key).toBe(videoKey);
    expect(result.audio.key).toBe(audioKey);
    expect(result.video.xml).toContain("https://u.steast.io/fixture/");
    expect(result.video.xml).not.toContain('id="audio"');
    expect(result.audio.xml).not.toContain('id="video"');
  });
  it("rejects missing keys, XML entities and private resource URLs", () => {
    expect(() => splitClearKeyManifest(xml, manifestUrl, {})).toThrow(
      "session-expired",
    );
    expect(() =>
      splitClearKeyManifest(`<!DOCTYPE MPD>${xml}`, manifestUrl, keys),
    ).toThrow("invalid");
    expect(() =>
      splitClearKeyManifest(
        xml.replace("video-init.mp4", "https://127.0.0.1/private"),
        manifestUrl,
        keys,
      ),
    ).toThrow("approved");
  });
  it("serves refreshed per-track MPDs and releases its loopback listener", async () => {
    const ticket = "fixture-ticket";
    const bootstrap = await envelope(ticket);
    let manifestReads = 0;
    const input = await prepareClearKey(
      `window.SE_CK=${JSON.stringify({ t: ticket, v: false })};`,
      "https://v2.streameast.ga/ClearKeyEmbed.php?t=fixture",
      new AbortController().signal,
      {
        fetcher: async (_request, init) => {
          if (init?.method === "POST") return Response.json(bootstrap);
          manifestReads += 1;
          return new Response(xml);
        },
      },
    );
    expect(input).not.toBeNull();
    if (input === null) throw new Error("Fixture did not prepare");
    try {
      const response = await fetch(input.input);
      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain('id="audio"');
      expect(manifestReads).toBe(2);
      expect(input.audioInputOptions).toEqual([
        "-cenc_decryption_key",
        audioKey,
      ]);
    } finally {
      await input.close();
    }
    await expect(fetch(input.input)).rejects.toThrow();
  });
});
