import { describe, expect, test } from "vitest";
import { VoiceFollowUpWindow } from "#src/voice-assistant/follow-up.ts";

describe("VoiceFollowUpWindow", () => {
  test("allows exactly two same-speaker wake-free continuations", () => {
    const followUp = new VoiceFollowUpWindow(() => 1000);
    followUp.arm("speaker", false);

    const first = followUp.resolveTranscript(
      "first follow up",
      true,
      "speaker",
    );
    expect(first).toEqual({ command: "first follow up", usedFollowUp: true });
    followUp.consume("speaker", first?.usedFollowUp ?? false);
    followUp.arm("speaker", first?.usedFollowUp ?? false);

    const second = followUp.resolveTranscript(
      "second follow up",
      true,
      "speaker",
    );
    expect(second).toEqual({ command: "second follow up", usedFollowUp: true });
    followUp.consume("speaker", second?.usedFollowUp ?? false);
    followUp.arm("speaker", second?.usedFollowUp ?? false);

    expect(
      followUp.resolveTranscript("third follow up", true, "speaker"),
    ).toBeNull();
  });

  test("rejects another speaker and an expired continuation", () => {
    let now = 1000;
    const followUp = new VoiceFollowUpWindow(() => now);
    followUp.arm("speaker", false);

    expect(followUp.isAllowed("other-speaker")).toBe(false);
    now += 15_000;
    expect(followUp.isAllowed("speaker")).toBe(false);
  });
});
