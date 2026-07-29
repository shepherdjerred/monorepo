import { describe, expect, test } from "bun:test";
import { createVoiceCloseTracker } from "@shepherdjerred/streambot/streamer/voice-close-source.ts";

describe("voice close source", () => {
  test("a recovery lease keeps one connection's observer alive after owner release", () => {
    let detachCount = 0;
    const tracker = createVoiceCloseTracker(() => {
      detachCount += 1;
    });
    const incident = tracker.retain();

    tracker.release();
    expect(detachCount).toBe(0);

    tracker.record({ code: 4014, deliberate: true, atMs: 1000 });
    expect(incident.lastVoiceCloseInfo()).toEqual({
      code: 4014,
      deliberate: true,
      atMs: 1000,
    });

    incident.release();
    expect(detachCount).toBe(1);
  });

  test("a transient close cannot replace a deliberate close for the same incident", () => {
    const tracker = createVoiceCloseTracker(() => null);

    expect(tracker.record({ code: 4014, deliberate: true, atMs: 1000 })).toBe(
      true,
    );
    expect(tracker.record({ code: 4006, deliberate: false, atMs: 1001 })).toBe(
      false,
    );
    expect(tracker.lastVoiceCloseInfo()?.code).toBe(4014);
  });
});
