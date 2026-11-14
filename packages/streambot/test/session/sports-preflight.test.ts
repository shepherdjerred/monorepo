import { afterEach, expect, it, vi } from "vitest";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import { resolveSource } from "@shepherdjerred/streambot/sources/resolve.ts";
import * as probe from "@shepherdjerred/streambot/sources/probe.ts";
import type { SportsResolver } from "@shepherdjerred/streambot/sports/types.ts";

afterEach(() => vi.restoreAllMocks());
const config = loadConfig({
  BOT_TOKEN: "fixture",
  TOKEN: "fixture",
  VIDEOS_DIR: "/tmp",
});
const source = {
  kind: "url" as const,
  url: "https://v2.streameast.ga/nba/fixture/",
  mode: "video" as const,
};

function fixture() {
  const close = vi.fn().mockResolvedValue(undefined);
  const prepare = vi.fn(async () => ({
    title: "Fixture",
    input: "http://127.0.0.1/private-session/video",
    headers: {},
    audioInput: "http://127.0.0.1/private-session/audio",
    audioInputOptions: ["-cenc_decryption_key", "synthetic-key"],
    close,
  }));
  const resolver: SportsResolver = {
    prepare,
    resolve: async () => {
      throw new Error("Legacy resolution must not run");
    },
  };
  return { prepare, close, resolver };
}

it("preflight probes per-track inputs then discards all private input state", async () => {
  const f = fixture();
  const inspect = vi.spyOn(probe, "probeMedia").mockResolvedValue({
    videoCodec: "h264",
    width: 640,
    height: 360,
    pixelFormat: "yuv420p",
    hdr: false,
    audioCodec: "aac",
    audioChannels: 2,
    durationSeconds: undefined,
  });
  const signal = new AbortController().signal;
  const result = await resolveSource(config, source, signal, {
    sportsResolver: f.resolver,
  });
  expect(result).toMatchObject({
    sportsRecipe: { sourceUrl: source.url },
    mediaKind: "video",
    live: true,
  });
  expect(result.ffmpegInput).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain("private-session");
  expect(JSON.stringify(result)).not.toContain("synthetic-key");
  expect(inspect).toHaveBeenCalledWith(
    config,
    "http://127.0.0.1/private-session/audio",
    signal,
    {
      headers: undefined,
      inputOptions: ["-cenc_decryption_key", "synthetic-key"],
    },
  );
  expect(f.close).toHaveBeenCalledOnce();
  await resolveSource(config, source, signal, {
    sportsResolver: f.resolver,
    preResolved: result,
  });
  expect(f.prepare).toHaveBeenCalledOnce();
});

it("preflight releases its session when the media probe fails", async () => {
  const f = fixture();
  vi.spyOn(probe, "probeMedia").mockResolvedValue(null);
  await expect(
    resolveSource(config, source, new AbortController().signal, {
      sportsResolver: f.resolver,
    }),
  ).rejects.toThrow("both audio and video");
  expect(f.close).toHaveBeenCalledOnce();
});
