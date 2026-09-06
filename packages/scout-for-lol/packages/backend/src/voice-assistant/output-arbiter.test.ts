import { describe, expect, test } from "vitest";
import { VoiceOutputArbiter } from "#src/voice-assistant/output-arbiter.ts";

const GUILD = "100000000000000001";

/** Records timer callbacks so a test can expire the bounded wait on demand. */
function recordingTimers() {
  const timers: (() => void)[] = [];
  const setTimer = (callback: () => void) => {
    timers.push(callback);
    return cancelNothing;
  };
  return { timers, setTimer };
}

function cancelNothing(): void {
  /* the fake timer has nothing to cancel */
}

describe("VoiceOutputArbiter", () => {
  test("alerts play at full volume while the assistant is quiet", async () => {
    const arbiter = new VoiceOutputArbiter();
    const gate = arbiter.playbackGate();
    await expect(gate(GUILD)).resolves.toEqual({ volumeMultiplier: 1 });
  });

  test("an alert waits for the assistant and restores full volume", async () => {
    const { setTimer } = recordingTimers();
    const arbiter = new VoiceOutputArbiter({ setTimer });
    const duck = arbiter.assistantDuck(GUILD);
    duck.duckChanged(true);
    expect(arbiter.isAssistantSpeaking(GUILD)).toBe(true);
    const gate = arbiter.playbackGate();
    const pending = gate(GUILD);
    // Reply finishes before the bounded wait elapses: the waiter wakes and
    // the alert plays at full volume.
    duck.duckChanged(false);
    await expect(pending).resolves.toEqual({ volumeMultiplier: 1 });
    expect(arbiter.isAssistantSpeaking(GUILD)).toBe(false);
  });

  test("a long assistant reply ducks the alert instead of dropping it", async () => {
    const { timers, setTimer } = recordingTimers();
    const arbiter = new VoiceOutputArbiter({ setTimer });
    arbiter.assistantDuck(GUILD).duckChanged(true);
    const pending = arbiter.playbackGate()(GUILD);
    // The bounded wait expires while the assistant is still talking.
    timers[0]?.();
    await expect(pending).resolves.toEqual({ volumeMultiplier: 0.3 });
  });

  test("guilds duck independently", async () => {
    const arbiter = new VoiceOutputArbiter();
    arbiter.assistantDuck(GUILD).duckChanged(true);
    await expect(arbiter.playbackGate()("200000000000000002")).resolves.toEqual(
      { volumeMultiplier: 1 },
    );
  });
});
