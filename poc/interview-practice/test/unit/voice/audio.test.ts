import { describe, test, expect, mock } from "bun:test";
import {
  checkAudioDependencies,
  createAudioManager,
} from "#lib/voice/audio.ts";
import type { Logger } from "#logger";

// eslint-disable-next-line @typescript-eslint/no-empty-function -- mock stub
const noop = (): void => {};

function createMockLogger(): Logger {
  const logger: Logger = {
    info: mock(noop),
    warn: mock(noop),
    error: mock(noop),
    debug: mock(noop),
    child: () => createMockLogger(),
  };
  return logger;
}

describe("checkAudioDependencies", () => {
  test("returns an object with ok and missing fields", () => {
    const result = checkAudioDependencies();
    expect(result).toHaveProperty("ok");
    expect(result).toHaveProperty("missing");
    expect(Array.isArray(result.missing)).toBe(true);
  });
});

describe("createAudioManager", () => {
  test("creates manager with expected interface", () => {
    const logger = createMockLogger();
    const manager = createAudioManager(logger);

    expect(manager.startMic).toBeFunction();
    expect(manager.stopMic).toBeFunction();
    expect(manager.startSpeaker).toBeFunction();
    expect(manager.stopSpeaker).toBeFunction();
    expect(manager.stopAll).toBeFunction();
    expect(manager.isMicActive).toBeFunction();
    expect(manager.isSpeakerActive).toBeFunction();
    expect(manager.gateMicWhileSpeaking).toBeFunction();
    expect(manager.onMicData).toBeFunction();
    expect(manager.writeSpeakerAudio).toBeFunction();
  });

  test("mic and speaker are inactive by default", () => {
    const logger = createMockLogger();
    const manager = createAudioManager(logger);

    expect(manager.isMicActive()).toBe(false);
    expect(manager.isSpeakerActive()).toBe(false);
  });

  test("stopAll is safe when nothing is started", () => {
    const logger = createMockLogger();
    const manager = createAudioManager(logger);

    expect(() => manager.stopAll()).not.toThrow();
  });

  test("gateMicWhileSpeaking does not throw", () => {
    const logger = createMockLogger();
    const manager = createAudioManager(logger);

    expect(() => manager.gateMicWhileSpeaking(true)).not.toThrow();
    expect(() => manager.gateMicWhileSpeaking(false)).not.toThrow();
  });

  test("onMicData registers callback without throwing", () => {
    const logger = createMockLogger();
    const manager = createAudioManager(logger);

    expect(() => {
      manager.onMicData(noop);
    }).not.toThrow();
  });

  test("writeSpeakerAudio when speaker not started does not throw", () => {
    const logger = createMockLogger();
    const manager = createAudioManager(logger);

    expect(() => manager.writeSpeakerAudio("dGVzdA==")).not.toThrow();
  });

  test("stopMic when mic not started is safe", () => {
    const logger = createMockLogger();
    const manager = createAudioManager(logger);

    expect(() => manager.stopMic()).not.toThrow();
  });

  test("stopSpeaker when speaker not started is safe", () => {
    const logger = createMockLogger();
    const manager = createAudioManager(logger);

    expect(() => manager.stopSpeaker()).not.toThrow();
  });
});
