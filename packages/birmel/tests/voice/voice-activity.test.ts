import { describe, test, expect, beforeEach } from "bun:test";
import {
  updateVoiceActivity,
  shouldProcessSpeech,
  resetVoiceActivity,
  getVoiceActivityState,
  isSpeaking,
  getSpeechDurationMs,
  cleanupInactiveStates,
  clearAllStates,
} from "../../src/voice/voice-activity.js";

describe("voice-activity", () => {
  beforeEach(() => {
    clearAllStates();
  });

  describe("updateVoiceActivity", () => {
    test("creates new state when user starts speaking", () => {
      updateVoiceActivity("user-1", true);
      const state = getVoiceActivityState("user-1");

      expect(state).not.toBeNull();
      expect(state?.isSpeaking).toBe(true);
      expect(state?.speakingStartedAt).not.toBeNull();
      expect(state?.silenceStartedAt).toBeNull();
    });

    test("tracks when user stops speaking", () => {
      updateVoiceActivity("user-1", true);
      updateVoiceActivity("user-1", false);
      const state = getVoiceActivityState("user-1");

      expect(state?.isSpeaking).toBe(false);
      expect(state?.silenceStartedAt).not.toBeNull();
    });

    test("does not change state on repeated speaking events", () => {
      updateVoiceActivity("user-1", true);
      const firstState = getVoiceActivityState("user-1");
      const firstSpeakingStart = firstState?.speakingStartedAt;

      updateVoiceActivity("user-1", true);
      const secondState = getVoiceActivityState("user-1");

      expect(secondState?.speakingStartedAt).toBe(firstSpeakingStart);
    });
  });

  describe("shouldProcessSpeech", () => {
    test("returns false for unknown user", () => {
      expect(shouldProcessSpeech("unknown-user")).toBe(false);
    });

    test("returns false if user is still speaking", () => {
      updateVoiceActivity("user-1", true);
      expect(shouldProcessSpeech("user-1")).toBe(false);
    });

    test("returns false if user never spoke", () => {
      updateVoiceActivity("user-1", false);
      expect(shouldProcessSpeech("user-1")).toBe(false);
    });

    test("returns false if silence duration is too short", () => {
      updateVoiceActivity("user-1", true);
      updateVoiceActivity("user-1", false);
      // Immediately checking - not enough silence
      expect(shouldProcessSpeech("user-1")).toBe(false);
    });
  });

  describe("isSpeaking", () => {
    test("returns false for unknown user", () => {
      expect(isSpeaking("unknown-user")).toBe(false);
    });

    test("returns true when user is speaking", () => {
      updateVoiceActivity("user-1", true);
      expect(isSpeaking("user-1")).toBe(true);
    });

    test("returns false when user stopped speaking", () => {
      updateVoiceActivity("user-1", true);
      updateVoiceActivity("user-1", false);
      expect(isSpeaking("user-1")).toBe(false);
    });
  });

  describe("getSpeechDurationMs", () => {
    test("returns null for unknown user", () => {
      expect(getSpeechDurationMs("unknown-user")).toBeNull();
    });

    test("returns null if user never spoke", () => {
      updateVoiceActivity("user-1", false);
      expect(getSpeechDurationMs("user-1")).toBeNull();
    });

    test("returns duration after user stops speaking", () => {
      updateVoiceActivity("user-1", true);
      updateVoiceActivity("user-1", false);
      const duration = getSpeechDurationMs("user-1");

      expect(duration).not.toBeNull();
      expect(duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe("resetVoiceActivity", () => {
    test("removes user state", () => {
      updateVoiceActivity("user-1", true);
      resetVoiceActivity("user-1");
      expect(getVoiceActivityState("user-1")).toBeNull();
    });

    test("does not throw for unknown user", () => {
      expect(() => resetVoiceActivity("unknown-user")).not.toThrow();
    });
  });

  describe("cleanupInactiveStates", () => {
    test("removes inactive states", async () => {
      updateVoiceActivity("user-1", true);
      updateVoiceActivity("user-1", false);

      // Wait a bit then cleanup with short threshold
      await new Promise((resolve) => setTimeout(resolve, 10));
      const cleaned = cleanupInactiveStates(5);
      expect(cleaned).toBe(1);
      expect(getVoiceActivityState("user-1")).toBeNull();
    });

    test("keeps active states", () => {
      updateVoiceActivity("user-1", true);
      updateVoiceActivity("user-1", false);

      // Cleanup with very high threshold keeps all
      const cleaned = cleanupInactiveStates(100000);
      expect(cleaned).toBe(0);
      expect(getVoiceActivityState("user-1")).not.toBeNull();
    });
  });

  describe("clearAllStates", () => {
    test("removes all states", () => {
      updateVoiceActivity("user-1", true);
      updateVoiceActivity("user-2", true);

      clearAllStates();

      expect(getVoiceActivityState("user-1")).toBeNull();
      expect(getVoiceActivityState("user-2")).toBeNull();
    });
  });
});
