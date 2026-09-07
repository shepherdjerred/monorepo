import { describe, expect, test } from "vitest";
import {
  assistantAudioTransport,
  type AssistantVoiceConnection,
} from "#src/voice-assistant/assistant-sender.ts";

function fakeConnection(calls: string[]): AssistantVoiceConnection {
  return {
    setSpeaking: (enabled) => {
      calls.push(`setSpeaking:${String(enabled)}`);
    },
    playOpusPacket: () => {
      calls.push("playOpusPacket");
    },
  };
}

/** A reservation promise the test controls the resolution of. */
function deferredReservation() {
  const state: { resolve: () => void } = { resolve: doNothing };
  const reserved = new Promise<void>((resolve) => {
    state.resolve = resolve;
  });
  return { reserved, release: () => state.resolve() };
}

function doNothing(): void {
  /* replaced synchronously by the Promise constructor */
}

describe("assistantAudioTransport", () => {
  test("setAssistantSpeaking(true) awaits the reservation before touching the connection", async () => {
    const calls: string[] = [];
    const { reserved, release } = deferredReservation();
    const transport = assistantAudioTransport(
      fakeConnection(calls),
      () => reserved,
    );

    let settled = false;
    const speaking = transport.setAssistantSpeaking(true);
    void (async () => {
      await speaking;
      settled = true;
    })();

    // The reservation has not resolved yet: the connection must not be
    // touched, matching the alert side never sending concurrently.
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(calls).toEqual([]);

    release();
    await speaking;
    expect(calls).toEqual(["setSpeaking:true"]);
  });

  test("setAssistantSpeaking(false) never consults the reservation", async () => {
    const calls: string[] = [];
    const transport = assistantAudioTransport(fakeConnection(calls), () => {
      throw new Error("reserveForAssistant must not be called for false");
    });
    await transport.setAssistantSpeaking(false);
    expect(calls).toEqual(["setSpeaking:false"]);
  });

  test("sendAssistantOpus forwards the packet unmodified", () => {
    const calls: string[] = [];
    const transport = assistantAudioTransport(fakeConnection(calls), () =>
      Promise.resolve(),
    );
    transport.sendAssistantOpus(new Uint8Array([1, 2, 3]));
    expect(calls).toEqual(["playOpusPacket"]);
  });
});
