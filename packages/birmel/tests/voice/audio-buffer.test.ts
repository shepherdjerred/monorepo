import { describe, test, expect, beforeEach } from "bun:test";
import {
  appendAudioChunk,
  getAudioBuffer,
  clearAudioBuffer,
  getLastActivityTime,
  getBufferDurationMs,
  hasAudioData,
  cleanupInactiveBuffers,
  clearAllBuffers,
} from "../../src/voice/audio-buffer.js";

describe("audio-buffer", () => {
  beforeEach(() => {
    clearAllBuffers();
  });

  describe("appendAudioChunk", () => {
    test("creates buffer for new user", () => {
      const chunk = Buffer.from([1, 2, 3, 4]);
      appendAudioChunk("user-1", chunk);

      expect(hasAudioData("user-1")).toBe(true);
    });

    test("appends multiple chunks", () => {
      appendAudioChunk("user-1", Buffer.from([1, 2]));
      appendAudioChunk("user-1", Buffer.from([3, 4]));

      const buffer = getAudioBuffer("user-1");
      expect(buffer).not.toBeNull();
      expect(buffer?.length).toBe(4);
      expect(buffer?.[0]).toBe(1);
      expect(buffer?.[3]).toBe(4);
    });

    test("updates last activity time", () => {
      appendAudioChunk("user-1", Buffer.from([1, 2, 3]));
      const time = getLastActivityTime("user-1");

      expect(time).not.toBeNull();
      expect(time).toBeGreaterThan(0);
    });
  });

  describe("getAudioBuffer", () => {
    test("returns null for unknown user", () => {
      expect(getAudioBuffer("unknown-user")).toBeNull();
    });

    test("returns concatenated buffer", () => {
      appendAudioChunk("user-1", Buffer.from([1, 2]));
      appendAudioChunk("user-1", Buffer.from([3, 4, 5]));

      const buffer = getAudioBuffer("user-1");
      expect(buffer).not.toBeNull();
      expect(buffer?.length).toBe(5);
    });
  });

  describe("clearAudioBuffer", () => {
    test("removes user buffer", () => {
      appendAudioChunk("user-1", Buffer.from([1, 2, 3]));
      clearAudioBuffer("user-1");

      expect(hasAudioData("user-1")).toBe(false);
      expect(getAudioBuffer("user-1")).toBeNull();
    });

    test("does not throw for unknown user", () => {
      expect(() => clearAudioBuffer("unknown-user")).not.toThrow();
    });
  });

  describe("getLastActivityTime", () => {
    test("returns null for unknown user", () => {
      expect(getLastActivityTime("unknown-user")).toBeNull();
    });

    test("returns timestamp for active user", () => {
      const before = Date.now();
      appendAudioChunk("user-1", Buffer.from([1]));
      const time = getLastActivityTime("user-1");
      const after = Date.now();

      expect(time).not.toBeNull();
      expect(time).toBeGreaterThanOrEqual(before);
      expect(time).toBeLessThanOrEqual(after);
    });
  });

  describe("getBufferDurationMs", () => {
    test("returns 0 for unknown user", () => {
      expect(getBufferDurationMs("unknown-user")).toBe(0);
    });

    test("returns approximate duration", () => {
      // 48kHz * 2 channels * 2 bytes per sample = 192000 bytes per second
      // 192 bytes = 1ms of audio
      const oneSecondOfAudio = Buffer.alloc(192000);
      appendAudioChunk("user-1", oneSecondOfAudio);

      const duration = getBufferDurationMs("user-1");
      expect(duration).toBeCloseTo(1000, -1); // Within 10ms
    });
  });

  describe("hasAudioData", () => {
    test("returns false for unknown user", () => {
      expect(hasAudioData("unknown-user")).toBe(false);
    });

    test("returns true after appending data", () => {
      appendAudioChunk("user-1", Buffer.from([1]));
      expect(hasAudioData("user-1")).toBe(true);
    });

    test("returns false after clearing", () => {
      appendAudioChunk("user-1", Buffer.from([1]));
      clearAudioBuffer("user-1");
      expect(hasAudioData("user-1")).toBe(false);
    });
  });

  describe("cleanupInactiveBuffers", () => {
    test("removes inactive buffers", async () => {
      appendAudioChunk("user-1", Buffer.from([1]));

      // Wait a bit then cleanup with short threshold
      await new Promise((resolve) => setTimeout(resolve, 10));
      const cleaned = cleanupInactiveBuffers(5);
      expect(cleaned).toBe(1);
      expect(hasAudioData("user-1")).toBe(false);
    });

    test("keeps active buffers", () => {
      appendAudioChunk("user-1", Buffer.from([1]));

      // Cleanup with very high threshold keeps all
      const cleaned = cleanupInactiveBuffers(100000);
      expect(cleaned).toBe(0);
      expect(hasAudioData("user-1")).toBe(true);
    });

    test("handles multiple users", async () => {
      appendAudioChunk("user-1", Buffer.from([1]));
      appendAudioChunk("user-2", Buffer.from([2]));

      // Wait a bit then cleanup with short threshold
      await new Promise((resolve) => setTimeout(resolve, 10));
      const cleaned = cleanupInactiveBuffers(5);
      expect(cleaned).toBe(2);
    });
  });

  describe("clearAllBuffers", () => {
    test("removes all buffers", () => {
      appendAudioChunk("user-1", Buffer.from([1]));
      appendAudioChunk("user-2", Buffer.from([2]));

      clearAllBuffers();

      expect(hasAudioData("user-1")).toBe(false);
      expect(hasAudioData("user-2")).toBe(false);
    });
  });
});
