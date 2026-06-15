import type { Subprocess } from "bun";
import type { Logger } from "#logger";

export type AudioManager = {
  startMic: () => void;
  stopMic: () => void;
  startSpeaker: () => void;
  stopSpeaker: () => void;
  stopAll: () => void;
  isMicActive: () => boolean;
  isSpeakerActive: () => boolean;
  gateMicWhileSpeaking: (speaking: boolean) => void;
  onMicData: (callback: (pcmBase64: string) => void) => void;
  writeSpeakerAudio: (pcmBase64: string) => void;
  flushSpeaker: () => void;
};

function checkBinaryExists(name: string): boolean {
  const result = Bun.spawnSync(["which", name]);
  return result.exitCode === 0;
}

export function checkAudioDependencies(): { ok: boolean; missing: string[] } {
  const required = ["sox"];
  const missing = required.filter((bin) => !checkBinaryExists(bin));
  return { ok: missing.length === 0, missing };
}

export function createAudioManager(logger: Logger): AudioManager {
  let micProc: Subprocess | null = null;
  let micActive = false;
  let micGated = false;
  let micDataCallback: ((pcmBase64: string) => void) | null = null;

  // Speaker: accumulate chunks, then play as a complete file on flush
  let speakerActive = false;
  const pendingChunks: Buffer[] = [];
  let playbackQueue: Promise<void> = Promise.resolve();

  function startMicCapture(): void {
    if (micProc !== null) return;

    micProc = Bun.spawn(
      [
        "sox",
        "-d",
        "-t",
        "raw",
        "-r",
        "24000",
        "-e",
        "signed",
        "-b",
        "16",
        "-c",
        "1",
        "-",
      ],
      {
        stdout: "pipe",
        stderr: "ignore",
      },
    );

    micActive = true;
    logger.info("mic_started");
    void readMicStream();
  }

  async function readMicStream(): Promise<void> {
    if (micProc === null) return;
    const stdout = micProc.stdout;
    if (typeof stdout !== "object" || !("getReader" in stdout)) return;

    const reader = stdout.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        if (!micGated && micDataCallback !== null) {
          const base64 = Buffer.from(value).toString("base64");
          micDataCallback(base64);
        }
      }
    } catch (error) {
      if (micActive) {
        logger.error("mic_read_error", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  async function playBuffer(buf: Buffer): Promise<void> {
    const tmpPath = `/tmp/interview-practice-audio-${String(Date.now())}.raw`;
    await Bun.write(tmpPath, buf);

    const proc = Bun.spawn(
      [
        "play",
        "-q",
        "-t",
        "raw",
        "-r",
        "24000",
        "-e",
        "signed-integer",
        "-b",
        "16",
        "-c",
        "1",
        "--endian",
        "little",
        tmpPath,
      ],
      {
        stdout: "ignore",
        stderr: "ignore",
      },
    );

    await proc.exited;

    try {
      const fs = await import("node:fs");
      fs.unlinkSync(tmpPath);
    } catch {
      /* ignore cleanup errors */
    }
  }

  return {
    startMic() {
      startMicCapture();
    },

    stopMic() {
      if (micProc !== null) {
        micActive = false;
        micProc.kill();
        micProc = null;
        logger.info("mic_stopped");
      }
    },

    startSpeaker() {
      speakerActive = true;
      logger.info("speaker_started");
    },

    stopSpeaker() {
      speakerActive = false;
      pendingChunks.length = 0;
      logger.info("speaker_stopped");
    },

    stopAll() {
      if (micProc !== null) {
        micActive = false;
        micProc.kill();
        micProc = null;
      }
      speakerActive = false;
      pendingChunks.length = 0;
      logger.info("audio_stopped_all");
    },

    isMicActive() {
      return micActive;
    },

    isSpeakerActive() {
      return speakerActive;
    },

    gateMicWhileSpeaking(speaking) {
      micGated = speaking;
    },

    onMicData(callback) {
      micDataCallback = callback;
    },

    writeSpeakerAudio(pcmBase64) {
      if (!speakerActive) return;
      const buffer = Buffer.from(pcmBase64, "base64");
      pendingChunks.push(buffer);
    },

    flushSpeaker() {
      if (pendingChunks.length === 0) return;
      const full = Buffer.concat(pendingChunks);
      pendingChunks.length = 0;
      logger.info("speaker_playing", { bytes: full.length });

      // Queue playback so multiple responses don't overlap
      const prevQueue = playbackQueue;
      playbackQueue = (async () => {
        await prevQueue;
        await playBuffer(full);
      })();
    },
  };
}
