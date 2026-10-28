import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSeekablePlayer } from "../../src/media/player.ts";

// Also runnable directly in the production image, without Vitest or credentials.
const ffmpegPath = Bun.which("ffmpeg");
assert(ffmpegPath, "system ffmpeg is required");
const directory = await mkdtemp(
  path.join(tmpdir(), "streambot-playback-smoke-"),
);
const input = path.join(directory, "avcc.mp4");
const generated = Bun.spawnSync([
  ffmpegPath,
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=320x180:rate=30:duration=8",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:sample_rate=48000:duration=8",
  "-c:v",
  "libx264",
  "-preset",
  "ultrafast",
  "-threads",
  "1",
  "-bf",
  "0",
  "-g",
  "30",
  "-pix_fmt",
  "yuv420p",
  "-flags",
  "+global_header",
  "-c:a",
  "aac",
  "-movflags",
  "+faststart",
  input,
]);
assert.equal(generated.exitCode, 0, generated.stderr.toString());

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 15_000;
  while (!predicate()) {
    assert(Date.now() < deadline, "timed out waiting for delivered media");
    await Bun.sleep(10);
  }
}

function playback(noTranscoding: boolean) {
  const sent = {
    video: 0,
    audio: 0,
    bytes: 0,
    packetizers: 0,
    opened: 0,
    closed: 0,
  };
  const attributes: { width: number; height: number; fps: number }[] = [];
  const conn = {
    setPacketizer() {
      sent.packetizers++;
    },
    sendVideoFrame(frame: Buffer, duration: number) {
      assert(frame.length > 0);
      assert(Number.isFinite(duration) && duration > 0);
      sent.video++;
      sent.bytes += frame.length;
    },
    sendAudioFrame(frame: Buffer, duration: number) {
      assert(frame.length > 0);
      assert.equal(duration, 20);
      sent.audio++;
      sent.bytes += frame.length;
      return true;
    },
    mediaConnection: {
      setSpeaking() {},
      setVideoAttributes(
        enabled: boolean,
        metadata: { width: number; height: number; fps: number },
      ) {
        if (enabled) attributes.push(metadata);
      },
    },
  };
  const streamer = {
    createStream: async () => {
      sent.opened++;
      return conn;
    },
    stopStream() {
      sent.closed++;
    },
  };
  const player = createSeekablePlayer(streamer, input, {
    prepare: {
      ffmpegPath,
      noTranscoding,
      width: 320,
      height: 180,
      frameRate: 30,
      readrate: 2,
    },
    play: { type: "go-live", streamPreview: false },
  });
  // Observe failures immediately even while a test is awaiting start or seeking.
  void player.finished.catch(() => {});
  return { player, sent, attributes };
}

const results: {
  scenario: string;
  video: number;
  audio: number;
  bytes: number;
}[] = [];
try {
  for (const noTranscoding of [true, false]) {
    const { player, sent, attributes } = playback(noTranscoding);
    try {
      await player.start();
      await player.finished;
      assert.deepEqual(attributes, [{ width: 320, height: 180, fps: 30 }]);
      assert(sent.video > 100, `only ${sent.video} video frames delivered`);
      assert(sent.audio > 200, `only ${sent.audio} audio frames delivered`);
      assert.equal(sent.opened, 1);
      assert.equal(sent.closed, 1);
      results.push({
        scenario: noTranscoding ? "avcc-copy" : "software-transcode",
        ...sent,
      });
    } finally {
      player.stop();
    }
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const { player, sent } = playback(true);
    try {
      await player.start();
      await Promise.race([
        until(() => sent.video >= 3 && sent.audio >= 3),
        player.finished,
      ]);
      assert(sent.video >= 3 && sent.audio >= 3);
      const before = { video: sent.video, audio: sent.audio };
      await player.seek(3);
      await Promise.race([
        until(
          () => sent.video > before.video + 3 && sent.audio > before.audio + 3,
        ),
        player.finished,
      ]);
      assert(
        sent.video > before.video + 3 && sent.audio > before.audio + 3,
        "replacement segment must deliver both audio and video",
      );
      assert.equal(player.position, 3);
      assert.equal(sent.opened, 1, "seek must retain the connection");
      assert.equal(sent.packetizers, 1, "seek must retain the RTP packetizer");
      player.stop();
      await player.finished;
      assert.equal(sent.closed, 1);
      results.push({ scenario: `seek-stop-${attempt}`, ...sent });
    } finally {
      player.stop();
    }
  }
  console.log(
    `PLAYBACK_SMOKE ${JSON.stringify({ runtime: Bun.version, platform: process.platform, arch: process.arch, results })}`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
