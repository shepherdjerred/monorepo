import { describe, test, expect } from "bun:test";
import {
  containsWakeWord,
  extractCommand,
  createVoiceCommand,
  expandCommandShortcut,
} from "../../src/voice/command-handler.js";

describe("command-handler", () => {
  describe("containsWakeWord", () => {
    test("detects 'hey birmel'", () => {
      expect(containsWakeWord("hey birmel")).toBe(true);
      expect(containsWakeWord("Hey Birmel")).toBe(true);
      expect(containsWakeWord("HEY BIRMEL")).toBe(true);
    });

    test("detects 'hi birmel'", () => {
      expect(containsWakeWord("hi birmel")).toBe(true);
      expect(containsWakeWord("Hi Birmel")).toBe(true);
    });

    test("detects 'ok birmel'", () => {
      expect(containsWakeWord("ok birmel")).toBe(true);
      expect(containsWakeWord("OK Birmel")).toBe(true);
    });

    test("detects 'birmel' alone", () => {
      expect(containsWakeWord("birmel")).toBe(true);
      expect(containsWakeWord("Birmel")).toBe(true);
    });

    test("detects wake word in sentence", () => {
      expect(containsWakeWord("hey birmel play some music")).toBe(true);
      expect(containsWakeWord("Can you birmel skip this song")).toBe(true);
    });

    test("returns false without wake word", () => {
      expect(containsWakeWord("hello")).toBe(false);
      expect(containsWakeWord("play some music")).toBe(false);
      expect(containsWakeWord("")).toBe(false);
    });

    test("handles whitespace", () => {
      expect(containsWakeWord("  hey birmel  ")).toBe(true);
      expect(containsWakeWord("\they birmel\n")).toBe(true);
    });
  });

  describe("extractCommand", () => {
    test("extracts command after 'hey birmel'", () => {
      expect(extractCommand("hey birmel play some music")).toBe("play some music");
    });

    test("extracts command after 'birmel'", () => {
      expect(extractCommand("birmel skip this song")).toBe("skip this song");
    });

    test("removes filler words", () => {
      expect(extractCommand("hey birmel please play music")).toBe("play music");
      expect(extractCommand("birmel can you skip")).toBe("skip");
      expect(extractCommand("hey birmel could you pause")).toBe("pause");
      expect(extractCommand("birmel would you stop")).toBe("stop");
      expect(extractCommand("hey birmel i want you to play")).toBe("play");
    });

    test("returns null for wake word only", () => {
      expect(extractCommand("hey birmel")).toBeNull();
      expect(extractCommand("birmel")).toBeNull();
    });

    test("returns null for wake word with only filler", () => {
      expect(extractCommand("hey birmel please")).toBeNull();
    });

    test("returns null when no wake word", () => {
      expect(extractCommand("play some music")).toBeNull();
    });

    test("handles case insensitivity", () => {
      expect(extractCommand("HEY BIRMEL PLAY MUSIC")).toBe("play music");
    });
  });

  describe("createVoiceCommand", () => {
    test("creates command with valid input", () => {
      const result = createVoiceCommand(
        "user-123",
        "guild-456",
        "channel-789",
        "hey birmel play some music"
      );

      expect(result).not.toBeNull();
      expect(result?.userId).toBe("user-123");
      expect(result?.guildId).toBe("guild-456");
      expect(result?.channelId).toBe("channel-789");
      expect(result?.rawText).toBe("hey birmel play some music");
      expect(result?.command).toBe("play some music");
      expect(result?.timestamp).toBeGreaterThan(0);
    });

    test("returns null without wake word", () => {
      const result = createVoiceCommand(
        "user-123",
        "guild-456",
        "channel-789",
        "play some music"
      );

      expect(result).toBeNull();
    });

    test("returns null with wake word but no command", () => {
      const result = createVoiceCommand(
        "user-123",
        "guild-456",
        "channel-789",
        "hey birmel"
      );

      expect(result).toBeNull();
    });
  });

  describe("expandCommandShortcut", () => {
    test("expands 'play something'", () => {
      expect(expandCommandShortcut("play something")).toBe("play some music");
    });

    test("expands 'stop'", () => {
      expect(expandCommandShortcut("stop")).toBe("stop the music");
    });

    test("expands 'pause'", () => {
      expect(expandCommandShortcut("pause")).toBe("pause the music");
    });

    test("expands 'resume'", () => {
      expect(expandCommandShortcut("resume")).toBe("resume the music");
    });

    test("expands 'skip'", () => {
      expect(expandCommandShortcut("skip")).toBe("skip this song");
    });

    test("expands 'next'", () => {
      expect(expandCommandShortcut("next")).toBe("skip to the next song");
    });

    test("expands volume shortcuts", () => {
      expect(expandCommandShortcut("louder")).toBe("increase the volume");
      expect(expandCommandShortcut("quieter")).toBe("decrease the volume");
      expect(expandCommandShortcut("mute")).toBe("set volume to 0");
      expect(expandCommandShortcut("unmute")).toBe("set volume to 50");
    });

    test("returns original for unknown commands", () => {
      expect(expandCommandShortcut("play never gonna give you up")).toBe(
        "play never gonna give you up"
      );
    });

    test("is case insensitive", () => {
      expect(expandCommandShortcut("STOP")).toBe("stop the music");
      expect(expandCommandShortcut("Pause")).toBe("pause the music");
    });

    test("trims whitespace", () => {
      expect(expandCommandShortcut("  stop  ")).toBe("stop the music");
    });
  });
});
