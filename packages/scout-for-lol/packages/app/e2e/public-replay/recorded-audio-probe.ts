import type { Page } from "@playwright/test";

type RecordedAudioProbe = {
  contextCount: number;
  closedCount: number;
  starts: {
    id: number;
    frames: number;
    wavSha256: string;
    delay: number;
    offset: number;
    rate: number;
    peak: number;
  }[];
  stops: number[];
};

declare global {
  var recordedAudioProbe: RecordedAudioProbe;
}

export async function installRecordedAudioProbe(page: Page) {
  await page.addInitScript(() => {
    const probe: RecordedAudioProbe = {
      contextCount: 0,
      closedCount: 0,
      starts: [],
      stops: [],
    };
    globalThis.recordedAudioProbe = probe;
    let nextSource = 0;
    const sourceDigests = new WeakMap<AudioBuffer, string>();

    // Decode real media through the browser without opening an audio device.
    class RecordingAudioContext {
      readonly destination = {};
      readonly #started = performance.now();

      constructor() {
        probe.contextCount++;
      }

      get currentTime() {
        return (performance.now() - this.#started) / 1000;
      }

      resume() {
        return Promise.resolve();
      }

      close() {
        probe.closedCount++;
        return Promise.resolve();
      }

      async decodeAudioData(bytes: ArrayBuffer) {
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        const buffer = await new OfflineAudioContext(
          2,
          1,
          44_100,
        ).decodeAudioData(bytes);
        sourceDigests.set(
          buffer,
          Array.from(new Uint8Array(digest), (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join(""),
        );
        return buffer;
      }

      createBufferSource() {
        const id = ++nextSource;
        const started = this.#started;
        class RecordingBufferSource {
          buffer: AudioBuffer | null = null;
          playbackRate = { value: 1 };
          onended = null;
          connect() {
            // The probe has no output device.
          }

          disconnect() {
            // The probe has no output device.
          }

          start(when = 0, offset = 0) {
            if (this.buffer === null)
              throw new Error("Missing replay audio buffer");
            const wavSha256 = sourceDigests.get(this.buffer);
            if (wavSha256 === undefined)
              throw new Error("Missing recorded replay audio digest");
            probe.starts.push({
              id,
              frames: this.buffer.length,
              wavSha256,
              delay: when - (performance.now() - started) / 1000,
              offset,
              rate: this.playbackRate.value,
              peak: this.buffer
                .getChannelData(0)
                .reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0),
            });
          }

          stop() {
            probe.stops.push(id);
          }
        }
        return new RecordingBufferSource();
      }
    }

    Object.defineProperty(globalThis, "AudioContext", {
      configurable: true,
      value: RecordingAudioContext,
    });
  });
}

export async function readRecordedAudioProbe(page: Page) {
  return page.evaluate(() => globalThis.recordedAudioProbe);
}
