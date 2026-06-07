import { createActor, waitFor } from "xstate";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import { createPlaybackMachine } from "@shepherdjerred/streambot/machine/playback-machine.ts";
import { resolveSource } from "@shepherdjerred/streambot/sources/resolve.ts";
import { StreambotStreamer } from "@shepherdjerred/streambot/streamer/streamer.ts";
import { UserIdSchema } from "@shepherdjerred/streambot/types/ids.ts";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { logger } from "@shepherdjerred/streambot/util/logger.ts";

/**
 * End-to-end test, run inside Dagger with real credentials (see `e2eStreambot`). Generates a short
 * test clip, drives it through the real machine + selfbot streamer into the configured voice
 * channel, asserts the machine reaches `streaming`, then stops cleanly. Exits non-zero on failure.
 */
const log = logger.child("e2e");
const TEST_CLIP = "/tmp/streambot-e2e.mp4";
const REQUESTER = UserIdSchema.parse("100000000000000001");
const STREAM_HOLD_MS = 5000;

async function generateClip(ffmpegPath: string): Promise<void> {
  const proc = Bun.spawn(
    [
      ffmpegPath,
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=duration=12:size=1280x720:rate=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=12",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-c:a",
      "aac",
      "-shortest",
      TEST_CLIP,
    ],
    { stdout: "pipe", stderr: "pipe", stdin: "ignore" },
  );
  const [stderr, code] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(
      `ffmpeg test-clip generation failed (code ${String(code)}): ${stderr.trim()}`,
    );
  }
}

async function main(): Promise<number> {
  const config = loadConfig();
  await generateClip(config.ffmpegPath);

  const streamer = new StreambotStreamer(config);
  const actor = createActor(
    createPlaybackMachine({
      joinVoice: streamer.joinVoice,
      resolveSource: (input, signal) =>
        resolveSource(config, input.source, signal),
      runStream: streamer.runStream,
      leaveVoice: streamer.leaveVoice,
    }),
    {
      input: {
        guildId: config.discord.guildId,
        channelId: config.discord.videoChannelId,
        idleTimeoutMs: 5000,
      },
    },
  );
  actor.start();
  await streamer.login();

  try {
    actor.send({
      type: "ADD",
      source: { kind: "file", path: TEST_CLIP, title: "e2e-test" },
      requesterId: REQUESTER,
    });
    await waitFor(actor, (snapshot) => snapshot.matches("streaming"), {
      timeout: 60_000,
    });
    log.info("e2e: reached streaming");
    await new Promise((resolve) => setTimeout(resolve, STREAM_HOLD_MS));

    actor.send({ type: "STOP" });
    await waitFor(actor, (snapshot) => snapshot.matches("idle"), {
      timeout: 30_000,
    });
    log.info("e2e: stopped cleanly — PASS");
    return 0;
  } catch (error) {
    log.error("e2e failed", { error: getErrorMessage(error) });
    return 1;
  } finally {
    actor.stop();
    await streamer.destroy();
  }
}

const code = await main();
process.exit(code);
