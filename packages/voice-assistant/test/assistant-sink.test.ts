import { describe, expect, test } from "vitest";
import {
  createNoopVoiceMetrics,
  PacedAssistantSender,
  type AssistantAudioTransport,
} from "@shepherdjerred/voice-assistant";

function fakeTransport() {
  const speaking: boolean[] = [];
  const packets: Uint8Array[] = [];
  let failSends = false;
  const transport: AssistantAudioTransport = {
    setAssistantSpeaking: (value) => {
      speaking.push(value);
      return Promise.resolve();
    },
    sendAssistantOpus: (packet) => {
      if (failSends) throw new Error("voice connection is gone");
      packets.push(packet);
    },
  };
  return {
    transport,
    speaking,
    packets,
    failSends: () => {
      failSends = true;
    },
  };
}

function sender(
  transport: AssistantAudioTransport,
  overrides: Partial<
    ConstructorParameters<typeof PacedAssistantSender>[1]
  > = {},
): PacedAssistantSender {
  return new PacedAssistantSender(transport, {
    stagePrefix: "test.voice",
    metrics: createNoopVoiceMetrics().reply,
    ...overrides,
  });
}

// One paced packet's worth of 24 kHz PCM16 keeps each test to a single 20 ms tick.
const ONE_PACKET_PCM = new Uint8Array(960);

describe("PacedAssistantSender", () => {
  test("marks the assistant speaking, paces Opus packets, and unmarks on finish", async () => {
    const fake = fakeTransport();
    const paced = sender(fake.transport);
    paced.enqueue(ONE_PACKET_PCM);
    await paced.finish();
    expect(fake.packets.length).toBeGreaterThan(0);
    expect(fake.speaking[0]).toBe(true);
    expect(fake.speaking.at(-1)).toBe(false);
  });

  test("reports duck transitions around the drain", async () => {
    const fake = fakeTransport();
    const ducks: { ducked: boolean; outcome: string | undefined }[] = [];
    const paced = sender(fake.transport, {
      duck: {
        duckChanged: (ducked, outcome) => {
          ducks.push({ ducked, outcome });
        },
      },
    });
    paced.enqueue(ONE_PACKET_PCM);
    await paced.finish();
    expect(ducks[0]).toEqual({ ducked: true, outcome: undefined });
    expect(ducks.at(-1)).toEqual({ ducked: false, outcome: "success" });
  });

  test("cancel before any audio settles immediately without touching the transport", async () => {
    const fake = fakeTransport();
    const paced = sender(fake.transport);
    await paced.cancel();
    expect(fake.packets).toEqual([]);
    expect(fake.speaking).toEqual([]);
    // Enqueues after cancellation are dropped.
    paced.enqueue(ONE_PACKET_PCM);
    await paced.finish();
    expect(fake.packets).toEqual([]);
  });

  test("counts send failures and stops pumping instead of rejecting the drain", async () => {
    const fake = fakeTransport();
    let sendFailures = 0;
    const metrics = createNoopVoiceMetrics().reply;
    const paced = sender(fake.transport, {
      metrics: {
        ...metrics,
        replySendFailures: {
          inc: () => {
            sendFailures += 1;
          },
        },
      },
    });
    fake.failSends();
    paced.enqueue(ONE_PACKET_PCM);
    await expect(paced.finish()).rejects.toThrow(
      "Assistant reply delivery failed",
    );
    expect(sendFailures).toBe(1);
    // The speaking flag is still restored on the failure path.
    expect(fake.speaking.at(-1)).toBe(false);
  });
});
