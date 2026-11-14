import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import { prepareLoaderHls } from "@shepherdjerred/streambot/sports/loader-hls.ts";
import { probeMedia } from "@shepherdjerred/streambot/sources/probe.ts";
import { sportsPng } from "#sports-png-fixture";
import { runCommand } from "./run-command.ts";

const config = loadConfig({
  BOT_TOKEN: "fixture-bot",
  USER_TOKENS: "fixture-user",
  VIDEOS_DIR: "/tmp/videos",
});
let directory: string;
let segment: Uint8Array;

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "streambot-sports-loader-"));
  const file = path.join(directory, "synthetic.ts");
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
    "-f",
    "mpegts",
    file,
  ]);
  segment = sportsPng(await readFile(file));
}, 120_000);

afterAll(async () => {
  if (directory !== undefined)
    await rm(directory, { recursive: true, force: true });
});

test("probes and decodes generated audio/video carried inside provider-style PNG segments", async () => {
  const prepared = await prepareLoaderHls(
    'var _seEsBoot={"t":"synthetic-ticket","hs":"https://hs.embedse.com/v/hs"};',
    "https://v2.streameast.ga/fixture/game/3",
    new AbortController().signal,
    {
      fetcher: async (input, init) => {
        if (init?.method === "POST")
          return Response.json({
            ok: true,
            q: "https://hs.embedse.com/q/fixture/index.m3u8",
          });
        const url = new URL(
          input instanceof Request ? input.url : input.toString(),
        );
        return url.pathname.endsWith(".m3u8")
          ? new Response(
              "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\nhttps://p16-common-sign.tiktokcdn.com/fixture.image\n#EXT-X-ENDLIST\n",
            )
          : new Response(segment);
      },
    },
  );
  if (prepared === null)
    throw new Error("Generated native HLS did not prepare");
  try {
    const info = await probeMedia(config, prepared.input);
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
      prepared.input,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0",
      "-f",
      "null",
      "-",
    ]);
  } finally {
    await prepared.close();
  }
}, 120_000);
