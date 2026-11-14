import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import { probeMedia } from "@shepherdjerred/streambot/sources/probe.ts";
import { runWithPreparedSportsInput } from "@shepherdjerred/streambot/sources/prepared-sports.ts";
import { buildPlaybackPrepareOptions } from "@shepherdjerred/streambot/streamer/prepare-options.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";
import { runCommand } from "./run-command.ts";
import { prepareClearKey } from "@shepherdjerred/streambot/sports/clearkey.ts";

// Deliberately public synthetic fixture keys, never provider credentials.
const VIDEO_KEY = Array.from({ length: 32 }, (_, index) =>
  (index % 16).toString(16),
).join("");
const AUDIO_KEY = Array.from({ length: 32 }, (_, index) =>
  (15 - (index % 16)).toString(16),
).join("");
const SINGLE_KEY = { "11111111111111111111111111111111": VIDEO_KEY };
const config = loadConfig({
  BOT_TOKEN: "fixture-bot",
  USER_TOKENS: "fixture-user",
  VIDEOS_DIR: "/tmp/videos",
});
let directory: string;
let hls: string;
let cencHlsDirectory: string;

async function syntheticEnvelope(
  manifest: string,
  keys: Readonly<Record<string, string>> = SINGLE_KEY,
) {
  const n = "integration-nonce";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`ck|integration-ticket|${n}`),
  );
  const key = await crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
  ]);
  const iv = new Uint8Array(12).fill(4);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(
      JSON.stringify({
        m: manifest,
        k: keys,
      }),
    ),
  );
  const bytes = new Uint8Array(iv.length + cipher.byteLength);
  bytes.set(iv);
  bytes.set(new Uint8Array(cipher), iv.length);
  return { ok: true, n, p: btoa(String.fromCodePoint(...bytes)) };
}

async function prepareDashFixture(signal: AbortSignal) {
  const bootstrap = await syntheticEnvelope(
    "https://u.steast.io/fixture/manifest.mpd",
    {
      "11111111111111111111111111111111": VIDEO_KEY,
      "22222222222222222222222222222222": AUDIO_KEY,
    },
  );
  const prepared = await prepareClearKey(
    'window.SE_CK={"t":"integration-ticket","v":false};',
    "https://v2.streameast.ga/ClearKeyEmbed.php?t=fixture",
    signal,
    {
      fetcher: async (request, init) => {
        if (init?.method === "POST") return Response.json(bootstrap);
        const url = new URL(
          request instanceof Request ? request.url : request.toString(),
        );
        return new Response(
          Bun.file(
            path.join(
              import.meta.dir,
              "fixtures/clearkey",
              path.basename(url.pathname),
            ),
          ),
        );
      },
    },
  );
  if (prepared === null) throw new Error("Synthetic DASH did not prepare");
  return prepared;
}

async function verifyDecodedAudio(
  source: string,
  inputOptions: readonly string[],
): Promise<void> {
  const audioDecode = Bun.spawn(
    [
      config.ffmpegPath,
      "-v",
      "error",
      "-xerror",
      ...inputOptions,
      "-i",
      source,
      "-map",
      "0:a:0",
      "-f",
      "s16le",
      "-",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [pcm, stderr, exitCode] = await Promise.all([
    new Response(audioDecode.stdout).arrayBuffer(),
    new Response(audioDecode.stderr).text(),
    audioDecode.exited,
  ]);
  expect(exitCode, stderr).toBe(0);
  // One second of 48 kHz mono PCM proves actual audio samples, not codec metadata.
  expect(pcm.byteLength).toBeGreaterThanOrEqual(90_000);
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "streambot-sports-media-"));
  cencHlsDirectory = path.join(directory, "cenc-hls");
  await mkdir(cencHlsDirectory);
  hls = path.join(directory, "plain.m3u8");
  await runCommand([
    config.ffmpegPath,
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x90:rate=10:duration=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=2",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-g",
    "10",
    "-c:a",
    "aac",
    "-hls_time",
    "1",
    "-hls_list_size",
    "0",
    "-f",
    "hls",
    hls,
  ]);
  await runCommand([
    config.ffmpegPath,
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x90:rate=10:duration=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=2",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-g",
    "10",
    "-c:a",
    "aac",
    "-encryption_scheme",
    "cenc-aes-ctr",
    "-encryption_key",
    VIDEO_KEY,
    "-encryption_kid",
    "11111111111111111111111111111111",
    "-movflags",
    "+faststart",
    path.join(cencHlsDirectory, "encrypted.mp4"),
  ]);
  await writeFile(
    path.join(cencHlsDirectory, "master.m3u8"),
    "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\nencrypted.mp4\n#EXT-X-ENDLIST\n",
  );
}, 120_000);

afterAll(async () => {
  if (directory !== undefined)
    await rm(directory, { recursive: true, force: true });
});

describe("sports media demux and decode", () => {
  test("normalizes ClearKey HLS and decodes encrypted audio/video through the adapter", async () => {
    const bootstrap = await syntheticEnvelope(
      "https://u.steast.io/fixture/master.m3u8",
    );
    const input = await prepareClearKey(
      'window.SE_CK={"t":"integration-ticket","v":false};',
      "https://v2.streameast.ga/ClearKeyEmbed.php?t=fixture",
      new AbortController().signal,
      {
        fetcher: async (request, init) => {
          if (init?.method === "POST") return Response.json(bootstrap);
          const url = new URL(
            request instanceof Request ? request.url : request.toString(),
          );
          const file = path.join(cencHlsDirectory, path.basename(url.pathname));
          if (file.endsWith(".m3u8")) {
            const text = await readFile(file, "utf8");
            return new Response(
              text.replace(
                "#EXTM3U",
                '#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES-CTR,KEYFORMAT="org.w3.clearkey",URI="unused-key"',
              ),
            );
          }
          return new Response(Bun.file(file));
        },
      },
    );
    if (input === null) throw new Error("ClearKey fixture did not prepare");
    try {
      const info = await probeMedia(config, input.input, undefined, {
        inputOptions: input.inputOptions,
      });
      expect(info).toMatchObject({
        videoCodec: "h264",
        audioCodec: "aac",
        width: 160,
        height: 90,
      });
      await runCommand([
        config.ffmpegPath,
        "-v",
        "error",
        "-xerror",
        ...(input.inputOptions ?? []),
        "-i",
        input.input,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0",
        "-f",
        "null",
        "-",
      ]);
    } finally {
      await input.close();
    }
  });
  test("probes and decodes ordinary HLS audio and video", async () => {
    const info = await probeMedia(config, hls);
    expect(info).toMatchObject({
      videoCodec: "h264",
      audioCodec: "aac",
      width: 160,
      height: 90,
    });
    await runCommand([
      config.ffmpegPath,
      "-v",
      "error",
      "-xerror",
      "-i",
      hls,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0",
      "-f",
      "null",
      "-",
    ]);
  });

  test("probes and decodes CENC DASH with different audio and video keys", async () => {
    let closed = false;
    await runWithPreparedSportsInput(
      {
        voice: {
          guildId: GuildIdSchema.parse("100000000000000001"),
          channelId: ChannelIdSchema.parse("100000000000000002"),
        },
        resolved: {
          title: "Synthetic DASH",
          mediaKind: "video",
          chapters: [],
          sportsRecipe: { sourceUrl: "https://v2.streameast.ga/fixture/" },
        },
        volume: 100,
        seekSeconds: 0,
        pipelineMode: "sw",
      },
      new AbortController().signal,
      async (_recipe, signal) => {
        const prepared = await prepareDashFixture(signal);
        return {
          ...prepared,
          close: async () => {
            closed = true;
            await prepared.close();
          },
        };
      },
      async ({ resolved }) => {
        const options = buildPlaybackPrepareOptions({
          stream: config.stream,
          resolved,
          startSeconds: 0,
          volumePercent: 100,
          pipelineMode: "sw",
        });
        if (
          resolved.ffmpegInput === undefined ||
          options.audioInput === undefined
        )
          throw new Error("Prepared DASH inputs are missing");
        const [video, audio] = await Promise.all([
          probeMedia(config, resolved.ffmpegInput, undefined, {
            inputOptions: options.customInputOptions,
          }),
          probeMedia(config, options.audioInput.source, undefined, {
            inputOptions: options.audioInput.inputOptions,
          }),
        ]);
        expect(video).toMatchObject({
          videoCodec: "h264",
          width: 64,
          height: 48,
        });
        expect(audio).toMatchObject({ audioCodec: "aac", audioChannels: 1 });
        await runCommand([
          config.ffmpegPath,
          "-v",
          "error",
          "-xerror",
          "-abort_on",
          "empty_output_stream",
          ...(options.customInputOptions ?? []),
          "-i",
          resolved.ffmpegInput,
          ...options.audioInput.inputOptions,
          "-i",
          options.audioInput.source,
          "-map",
          "0:v:0",
          "-map",
          "1:a:0",
          "-f",
          "null",
          "-",
        ]);
        await verifyDecodedAudio(
          options.audioInput.source,
          options.audioInput.inputOptions,
        );
      },
    );
    expect(closed).toBe(true);
  });

  test("rejects decoding encrypted video with the audio key", async () => {
    const prepared = await prepareDashFixture(new AbortController().signal);
    try {
      await expect(
        runCommand([
          config.ffmpegPath,
          "-v",
          "error",
          "-xerror",
          "-cenc_decryption_key",
          AUDIO_KEY,
          "-i",
          prepared.input,
          "-map",
          "0:v:0",
          "-f",
          "null",
          "-",
        ]),
      ).rejects.toThrow("command failed");
    } finally {
      await prepared.close();
    }
  });
});
