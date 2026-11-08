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

// Music reaches ffmpeg as a WebM/Opus file URL (YouTube `bestaudio`). Matroska reads to the HTTP
// end of file, which is exactly where an at-EOF reconnect used to keep ffmpeg alive forever.
const musicInput = path.join(directory, "music.webm");
const generatedMusic = Bun.spawnSync([
  ffmpegPath,
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:sample_rate=48000:duration=3",
  "-c:a",
  "libopus",
  "-b:a",
  "96k",
  musicInput,
]);
assert.equal(
  generatedMusic.exitCode,
  0,
  generatedMusic.stderr.toString(),
);

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

/**
 * Audio-only music over the borrowed voice connection, read from HTTP like a real source.
 * `finished` must settle on the natural end of the file. A hang here is the production symptom:
 * the track plays out, ffmpeg never exits, and the stall watchdog fires instead of advancing.
 */
async function voiceHttpNaturalEnd() {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(Bun.file(musicInput)),
  });
  let audio = 0;
  const conn = {
    setPacketizer() {
      throw new Error("a voice segment must not configure the connection");
    },
    sendVideoFrame() {
      throw new Error("a voice segment must not send video");
    },
    sendAudioFrame() {
      throw new Error("a voice segment must write through its audio sink");
    },
    mediaConnection: {
      setSpeaking() {},
      setVideoAttributes() {},
    },
  };
  const streamer = {
    voiceConnection: { webRtcConn: conn },
    createStream: () => {
      throw new Error("a voice segment must not open Go Live");
    },
    stopStream() {},
  };
  const player = createSeekablePlayer(
    streamer,
    `http://127.0.0.1:${String(server.port)}/music.webm`,
    {
      prepare: { ffmpegPath, audioOnly: true, readrate: 2 },
      play: {
        type: "voice",
        audioSink: {
          sendAudioFrame(frame: Buffer, duration: number) {
            assert(frame.length > 0);
            assert.equal(duration, 20);
            audio++;
            return true;
          },
        },
      },
    },
  );
  void player.finished.catch(() => {});
  const startedAt = Date.now();
  try {
    await player.start();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      player.finished,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              "voice playback of an HTTP file did not finish at its natural end",
            ),
          );
        }, 12_000);
      }),
    ]).finally(() => {
      clearTimeout(timer);
    });
    // 3 s of 20 ms Opus frames, minus encoder priming; all of it must reach the sink.
    assert(audio > 120, `only ${String(audio)} music frames delivered`);
    results.push({
      scenario: "voice-http-natural-end",
      video: 0,
      audio,
      bytes: 0,
      elapsedMs: Date.now() - startedAt,
    });
  } finally {
    player.stop();
    await server.stop(true);
  }
}

const results: {
  scenario: string;
  video: number;
  audio: number;
  bytes: number;
  elapsedMs?: number;
}[] = [];
try {
  await voiceHttpNaturalEnd();
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
