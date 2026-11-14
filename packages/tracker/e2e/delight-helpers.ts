import { expect, type Page } from "@playwright/test";
import { z } from "zod";
import { cueNames, cueSignature } from "#client/feedback/cues.ts";

/**
 * Replace Web Audio and the Vibration API with recorders before the app
 * loads. Each cue's tones start in one synchronous call, so tones started in
 * the same task form one cue, named by its waveform-and-pitch signature.
 */
function installFeedbackRecorder() {
  const cues: string[][] = [];
  const vibrations: unknown[] = [];
  let current: string[] | undefined;
  const record = (tone: string) => {
    if (current === undefined) {
      const cue: string[] = [];
      current = cue;
      cues.push(cue);
      queueMicrotask(() => {
        current = undefined;
      });
    }
    current.push(tone);
  };
  class Param {
    value = 0;
    setValueAtTime(value: number) {
      this.value = value;
      return this;
    }
    linearRampToValueAtTime() {
      return this;
    }
    exponentialRampToValueAtTime() {
      return this;
    }
  }
  class Node {
    connect<T>(next: T) {
      return next;
    }
    disconnect() {
      return this;
    }
  }
  class Oscillator extends Node {
    type = "sine";
    frequency = new Param();
    start() {
      record(`${this.type}:${String(this.frequency.value)}`);
    }
    stop() {
      return this;
    }
  }
  class Source extends Node {
    buffer: unknown = null;
    start() {
      record("noise");
    }
    stop() {
      return this;
    }
  }
  class Filter extends Node {
    type = "lowpass";
    frequency = new Param();
    Q = new Param();
  }
  class Gain extends Node {
    gain = new Param();
  }
  class RecordingAudioContext {
    state = "running";
    sampleRate = 44_100;
    destination = new Node();
    get currentTime() {
      return performance.now() / 1000;
    }
    createOscillator() {
      return new Oscillator();
    }
    createGain() {
      return new Gain();
    }
    createBiquadFilter() {
      return new Filter();
    }
    createBufferSource() {
      return new Source();
    }
    createBuffer(_channels: number, length: number) {
      return { getChannelData: () => new Float32Array(length) };
    }
    resume() {
      return Promise.resolve();
    }
  }
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: RecordingAudioContext,
  });
  Object.defineProperty(Navigator.prototype, "vibrate", {
    configurable: true,
    value: (pattern: unknown) => {
      vibrations.push(pattern);
      return true;
    },
  });
  Object.defineProperty(globalThis, "__feedback", {
    value: { cues, vibrations },
  });
}

export async function recordFeedback(page: Page) {
  await page.addInitScript(installFeedbackRecorder);
}

const RecordedSchema = z.object({
  cues: z.array(z.array(z.string())),
  vibrations: z.array(z.unknown()),
});

const nameOf = new Map(
  cueNames.map((name) => [cueSignature(name).join(" "), name]),
);

/** The cues played so far, by name, and the vibration patterns. */
export async function played(page: Page) {
  const raw: unknown = await page.evaluate((): unknown =>
    Reflect.get(globalThis, "__feedback"),
  );
  const recorded = RecordedSchema.parse(raw);
  return {
    cues: recorded.cues.map(
      (tones) => nameOf.get(tones.join(" ")) ?? tones.join(" "),
    ),
    vibrations: recorded.vibrations,
  };
}

/** Forget what was recorded, so a step's own feedback can be counted. */
export async function clearFeedback(page: Page) {
  // Runs in the page, where only the recorder's own arrays exist.
  await page.evaluate(() => {
    const recorded: unknown = Reflect.get(globalThis, "__feedback");
    for (const name of ["cues", "vibrations"]) {
      const list: unknown =
        typeof recorded === "object" && recorded !== null
          ? Reflect.get(recorded, name)
          : undefined;
      if (Array.isArray(list)) {
        list.length = 0;
      }
    }
  });
}

export async function expectCues(page: Page, cues: readonly string[]) {
  await expect
    .poll(async () => {
      const recorded = await played(page);
      return recorded.cues;
    })
    .toEqual(cues);
}

/**
 * Let the 40 ms pacing let through a cue or vibration it is holding back,
 * so a later count sees everything the last step caused.
 */
export async function afterPacing(page: Page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        globalThis.setTimeout(resolve, 150);
      }),
  );
}
