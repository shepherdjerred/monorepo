import { describe, expect, test } from "vitest";
import { VoiceOutputArbiter } from "#src/voice-assistant/output-arbiter.ts";

const GUILD = "100000000000000001";

/** Resolves once `promise` settles; false until then. Never throws. */
function settledFlag(promise: Promise<unknown>): () => boolean {
  let settled = false;
  void (async () => {
    await promise;
    settled = true;
  })();
  return () => settled;
}

async function expectAssistantToWaitForAlert(
  arbiter: VoiceOutputArbiter,
): Promise<void> {
  const { release } = await arbiter.playbackGate()(GUILD);
  const reserved = arbiter.reserveForAssistant(GUILD);
  const isSettled = settledFlag(reserved);
  await Promise.resolve();
  await Promise.resolve();
  expect(isSettled()).toBe(false);
  release();
  await reserved;
  expect(isSettled()).toBe(true);
}

describe("VoiceOutputArbiter — alert side", () => {
  test("alerts play at full volume while the assistant is quiet", async () => {
    const arbiter = new VoiceOutputArbiter();
    const gate = arbiter.playbackGate();
    const result = await gate(GUILD);
    expect(result.volumeMultiplier).toBe(1);
  });

  test("an alert waits for the assistant to fall fully silent, however long that takes", async () => {
    const arbiter = new VoiceOutputArbiter();
    const duck = arbiter.assistantDuck(GUILD);
    duck.duckChanged(true);
    expect(arbiter.isAssistantSpeaking(GUILD)).toBe(true);
    const gate = arbiter.playbackGate();
    const pending = gate(GUILD);
    const isSettled = settledFlag(pending);

    // Still speaking: the alert must not be released early, regardless of
    // how long it has been waiting — the two are never concurrent producers
    // on the same connection.
    await Promise.resolve();
    await Promise.resolve();
    expect(isSettled()).toBe(false);

    duck.duckChanged(false);
    const result = await pending;
    expect(result.volumeMultiplier).toBe(1);
    expect(arbiter.isAssistantSpeaking(GUILD)).toBe(false);
  });

  test("guilds are arbitrated independently", async () => {
    const arbiter = new VoiceOutputArbiter();
    arbiter.assistantDuck(GUILD).duckChanged(true);
    const result = await arbiter.playbackGate()("200000000000000002");
    expect(result.volumeMultiplier).toBe(1);
  });

  test("multiple alerts queued behind one reply are all released together", async () => {
    const arbiter = new VoiceOutputArbiter();
    const duck = arbiter.assistantDuck(GUILD);
    duck.duckChanged(true);
    const gate = arbiter.playbackGate();
    const first = gate(GUILD);
    const second = gate(GUILD);
    duck.duckChanged(false);
    await expect(first).resolves.toMatchObject({ volumeMultiplier: 1 });
    await expect(second).resolves.toMatchObject({ volumeMultiplier: 1 });
  });
});

describe("VoiceOutputArbiter — bidirectional reservation", () => {
  test("the assistant waits for an in-flight alert to release before sending anything", async () => {
    const arbiter = new VoiceOutputArbiter();
    // The alert has not released yet: the assistant must not be allowed to
    // send its first packet, however long the alert takes to finish.
    await expectAssistantToWaitForAlert(arbiter);
  });

  test("reserveForAssistant resolves immediately when no alert is in flight", async () => {
    const arbiter = new VoiceOutputArbiter();
    const isSettled = settledFlag(arbiter.reserveForAssistant(GUILD));
    await Promise.resolve();
    expect(isSettled()).toBe(true);
  });

  test("an alert that starts first blocks a wake accepted mid-playback", async () => {
    const arbiter = new VoiceOutputArbiter();
    // The alert acquires the connection before any reply exists.
    // A wake is accepted while the alert is still playing.
    // The alert finishes (VoiceManager.playSound's finally calls this on
    // every completion path: idle, error, or its own timeout).
    await expectAssistantToWaitForAlert(arbiter);
  });

  test("reservations do not cross guilds", async () => {
    const arbiter = new VoiceOutputArbiter();
    await arbiter.playbackGate()(GUILD);
    const isSettled = settledFlag(
      arbiter.reserveForAssistant("200000000000000002"),
    );
    await Promise.resolve();
    expect(isSettled()).toBe(true);
  });
});
