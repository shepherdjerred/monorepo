import { describe, expect, test } from "vitest";
import { verifyWakeTranscript } from "@shepherdjerred/voice-assistant";

const PREFIXES = ["hey streambot", "hey stream bot", "hey streamboat"];

describe("verifyWakeTranscript", () => {
  test("accepts only the configured leading normalized wake prefixes", () => {
    expect(
      verifyWakeTranscript("Hey, Streambot! Skip.", PREFIXES)?.command,
    ).toBe("skip");
    expect(
      verifyWakeTranscript("HEY STREAM BOT play local", PREFIXES)?.command,
    ).toBe("play local");
    expect(
      verifyWakeTranscript("hey streamboat volume 50", PREFIXES)?.command,
    ).toBe("volume 50");
    expect(
      verifyWakeTranscript("please tell hey streambot to stop", PREFIXES),
    ).toBeNull();
    expect(verifyWakeTranscript("hey streamer stop", PREFIXES)).toBeNull();
  });

  test("treats a bare wake phrase as an empty command", () => {
    expect(verifyWakeTranscript("Hey Streambot.", PREFIXES)).toEqual({
      normalized: "hey streambot",
      command: "",
    });
  });

  test("gates on the prefixes it is given, not any built-in phrase", () => {
    const scout = ["hey scout"];
    expect(
      verifyWakeTranscript("Hey Scout, what's Karthus ult cooldown?", scout)
        ?.command,
    ).toBe("what s karthus ult cooldown");
    expect(verifyWakeTranscript("hey streambot skip", scout)).toBeNull();
    expect(verifyWakeTranscript("hey scout skip", PREFIXES)).toBeNull();
  });
});
