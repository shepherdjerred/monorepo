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
};

function checkBinaryExists(name: string): boolean {
  const result = Bun.spawnSync(["which", name]);
  return result.exitCode === 0;
}

export function checkAudioDependencies(): { ok: boolean; missing: string[] } {
  const required = ["sox", "ffplay"];
  const missing = required.filter((bin) => !checkBinaryExists(bin));
  return { ok: missing.length === 0, missing };
}

export function createAudioManager(logger: Logger): AudioManager {
  let micProc: Subprocess | null = null;
  let speakerProc: Subprocess | null = null;
  let micActive = false;
  let speakerActive = false;
  let micGated = false;
  let micDataCallback: ((pcmBase64: string) => void) | null = null;

  function startMicCapture(): void {
    if (micProc !== null) return;

    // sox -d -t raw -r 24000 -e signed -b 16 -c 1 -
    // Captures microphone input as raw PCM 24kHz 16-bit mono
    micProc = Bun.spawn(
      ["sox", "-d", "-t", "raw", "-r", "24000", "-e", "signed", "-b", "16", "-c", "1", "-"],
      {
        stdout: "pipe",
        stderr: "ignore",
      },
    );

    micActive = true;
    logger.info("mic_started");

    // Read mic data in chunks and forward as base64
    void readMicStream();
  }

  async function readMicStream(): Promise<void> {
    if (micProc === null) return;
    const stdout = micProc.stdout;
    // stdout is ReadableStream when spawned with stdout: "pipe"
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

  let speakerFifoPath: string | null = null;
  let speakerFifoFd: number | null = null;

  function startSpeakerPlayback(): void {
    if (speakerProc !== null) return;

    // Use a named pipe (FIFO) — Bun's stdin pipe doesn't flush reliably to sox
    const fifoPath = `/tmp/interview-practice-speaker-${String(Date.now())}.pcm`;
    Bun.spawnSync(["mkfifo", fifoPath]);
    speakerFifoPath = fifoPath;

    // Start sox reading from the FIFO (will block until we open write end)
    speakerProc = Bun.spawn(
      ["play", "-t", "raw", "-r", "24000", "-e", "signed-integer", "-b", "16", "-c", "1", "--endian", "little", fifoPath],
      {
        stdout: "ignore",
        stderr: "ignore",
      },
    );

    // Open write end of FIFO (must be after sox starts reading, use non-blocking open)
    const fs = require("node:fs") as typeof import("node:fs");
    speakerFifoFd = fs.openSync(fifoPath, "w");

    speakerActive = true;
    logger.info("speaker_started", { fifo: fifoPath });
  }

  function cleanupSpeaker(): void {
    const fs = require("node:fs") as typeof import("node:fs");
    if (speakerFifoFd !== null) {
      try { fs.closeSync(speakerFifoFd); } catch { /* ignore */ }
      speakerFifoFd = null;
    }
    if (speakerProc !== null) {
      speakerActive = false;
      speakerProc.kill();
      speakerProc = null;
    }
    if (speakerFifoPath !== null) {
      try { fs.unlinkSync(speakerFifoPath); } catch { /* ignore */ }
      speakerFifoPath = null;
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
      startSpeakerPlayback();
    },

    stopSpeaker() {
      cleanupSpeaker();
      logger.info("speaker_stopped");
    },

    stopAll() {
      if (micProc !== null) {
        micActive = false;
        micProc.kill();
        micProc = null;
      }
      cleanupSpeaker();
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
      logger.debug("mic_gated", { gated: speaking });
    },

    onMicData(callback) {
      micDataCallback = callback;
    },

    writeSpeakerAudio(pcmBase64) {
      if (speakerFifoFd === null) {
        logger.debug("speaker_write_skip", { reason: "no_fifo" });
        return;
      }

      try {
        const buffer = Buffer.from(pcmBase64, "base64");
        const fs = require("node:fs") as typeof import("node:fs");
        fs.writeSync(speakerFifoFd, buffer);
      } catch (error) {
        logger.error("speaker_write_error", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
