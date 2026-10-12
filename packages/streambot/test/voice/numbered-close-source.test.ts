import { describe, expect, test } from "vitest";
import { createVoiceCloseTracker } from "@shepherdjerred/streambot/streamer/voice-close-source.ts";

describe("shared account close attribution", () => {
  test("a Go Live removal cannot classify the ordinary voice connection as kicked", () => {
    const tracker = createVoiceCloseTracker(() => {
      /* no transport */
    });
    tracker.record({
      source: "go-live",
      code: 4014,
      deliberate: true,
      atMs: 1,
    });
    expect(tracker.lastVoiceCloseInfo("voice")).toBeNull();
    expect(tracker.lastVoiceCloseInfo()?.code).toBe(4014);
    expect(
      tracker.record({
        source: "go-live",
        code: 4015,
        deliberate: false,
        atMs: 2,
      }),
    ).toBe(true);
    expect(tracker.lastVoiceCloseInfo()?.code).toBe(4015);
    tracker.release();
  });
  test("a late ordinary voice kick survives sibling Go Live cleanup and retained recovery observers", () => {
    const tracker = createVoiceCloseTracker(() => {
      /* no transport */
    });
    const retained = tracker.retain();
    tracker.record({ code: 4014, deliberate: true, atMs: 1 });
    tracker.record({
      source: "go-live",
      code: 4015,
      deliberate: false,
      atMs: 2,
    });
    tracker.release();
    expect(retained.lastVoiceCloseInfo("voice")?.deliberate).toBe(true);
    expect(retained.lastVoiceCloseInfo()?.deliberate).toBe(true);
    expect(tracker.record({ code: 4015, deliberate: false, atMs: 3 })).toBe(
      false,
    );
    retained.release();
  });
});
