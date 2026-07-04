import { describe, expect, test } from "bun:test";
import {
  CLOSE_INFO_FRESHNESS_MS,
  buildReconnectExhaustedAnnouncement,
  classifyVoiceLoss,
  voiceLossStopReason,
} from "@shepherdjerred/streambot/session/voice-recovery.ts";

const NOW = 1_000_000;

describe("classifyVoiceLoss", () => {
  test("fresh 4014 is deliberate", () => {
    const result = classifyVoiceLoss(
      { code: 4014, deliberate: true, atMs: NOW - 1000 },
      NOW,
    );
    expect(result.deliberate).toBe(true);
    expect(result.detail).toBe(
      "streamer was disconnected from voice (close code 4014)",
    );
  });

  test("stale 4014 (older than the freshness window) is transient", () => {
    const result = classifyVoiceLoss(
      { code: 4014, deliberate: true, atMs: NOW - CLOSE_INFO_FRESHNESS_MS - 1 },
      NOW,
    );
    expect(result.deliberate).toBe(false);
    expect(result.detail).toBe(
      "voice connection lost (no close code observed)",
    );
  });

  test("no close info is transient", () => {
    const result = classifyVoiceLoss(null, NOW);
    expect(result.deliberate).toBe(false);
    expect(result.detail).toBe(
      "voice connection lost (no close code observed)",
    );
  });

  test("fresh non-4014 close is transient with the code in the detail", () => {
    const result = classifyVoiceLoss(
      { code: 4006, deliberate: false, atMs: NOW - 1000 },
      NOW,
    );
    expect(result.deliberate).toBe(false);
    expect(result.detail).toBe("voice connection dropped (close code 4006)");
  });

  test("a custom freshness window is honored", () => {
    const close = { code: 4014, deliberate: true, atMs: NOW - 20_000 };
    expect(classifyVoiceLoss(close, NOW).deliberate).toBe(false);
    expect(classifyVoiceLoss(close, NOW, 30_000).deliberate).toBe(true);
  });
});

describe("voiceLossStopReason", () => {
  test("appends the reconnect notice only when reconnecting", () => {
    const classification = {
      deliberate: false,
      detail: "voice connection dropped (close code 4006)",
    };
    expect(voiceLossStopReason(classification, true)).toBe(
      "voice connection dropped (close code 4006) — reconnecting shortly",
    );
    expect(voiceLossStopReason(classification, false)).toBe(
      "voice connection dropped (close code 4006)",
    );
  });
});

describe("buildReconnectExhaustedAnnouncement", () => {
  test("pluralizes attempts and promises restart-time resume", () => {
    expect(buildReconnectExhaustedAnnouncement(1)).toContain("1 attempt.");
    const multi = buildReconnectExhaustedAnnouncement(3);
    expect(multi).toContain("3 attempts.");
    expect(multi).toContain("resume automatically on the next restart");
    // The state file only re-reads on restart; never promise a manual /stream play resume.
    expect(multi).not.toContain("/stream play");
  });
});
