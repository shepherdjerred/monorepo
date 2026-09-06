import { describe, expect, test } from "vitest";
import { VoiceOutputArbiter } from "#src/voice-assistant/output-arbiter.ts";

const GUILD = "100000000000000001";

describe("VoiceOutputArbiter", () => {
  test("alerts play at full volume while the assistant is quiet", async () => {
    const arbiter = new VoiceOutputArbiter();
    const gate = arbiter.playbackGate();
    await expect(gate(GUILD)).resolves.toEqual({ volumeMultiplier: 1 });
  });

  test("an alert waits for the assistant to fall fully silent, however long that takes", async () => {
    const arbiter = new VoiceOutputArbiter();
    const duck = arbiter.assistantDuck(GUILD);
    duck.duckChanged(true);
    expect(arbiter.isAssistantSpeaking(GUILD)).toBe(true);
    const gate = arbiter.playbackGate();
    const pending = gate(GUILD);

    let settled = false;
    void (async () => {
      await pending;
      settled = true;
    })();
    // Still speaking: the alert must not be released early, regardless of
    // how long it has been waiting — the two are never concurrent producers
    // on the same connection.
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    duck.duckChanged(false);
    await expect(pending).resolves.toEqual({ volumeMultiplier: 1 });
    expect(arbiter.isAssistantSpeaking(GUILD)).toBe(false);
  });

  test("guilds are arbitrated independently", async () => {
    const arbiter = new VoiceOutputArbiter();
    arbiter.assistantDuck(GUILD).duckChanged(true);
    await expect(arbiter.playbackGate()("200000000000000002")).resolves.toEqual(
      { volumeMultiplier: 1 },
    );
  });

  test("multiple alerts queued behind one reply are all released together", async () => {
    const arbiter = new VoiceOutputArbiter();
    const duck = arbiter.assistantDuck(GUILD);
    duck.duckChanged(true);
    const gate = arbiter.playbackGate();
    const first = gate(GUILD);
    const second = gate(GUILD);
    duck.duckChanged(false);
    await expect(first).resolves.toEqual({ volumeMultiplier: 1 });
    await expect(second).resolves.toEqual({ volumeMultiplier: 1 });
  });
});
