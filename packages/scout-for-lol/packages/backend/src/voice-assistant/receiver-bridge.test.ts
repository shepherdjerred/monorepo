import { describe, expect, test } from "vitest";
import type { VoiceAudioInput } from "@shepherdjerred/voice-assistant";
import {
  VoiceReceiverBridge,
  type OpusReceiveStream,
  type VoiceReceiverLike,
} from "#src/voice-assistant/receiver-bridge.ts";

class FakeStream implements OpusReceiveStream {
  private readonly dataListeners: ((chunk: Uint8Array) => void)[] = [];
  private readonly errorListeners: ((error: Error) => void)[] = [];
  destroyed = false;

  on(event: "data", listener: (chunk: Uint8Array) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(
    event: "data" | "error",
    listener: ((chunk: Uint8Array) => void) & ((error: Error) => void),
  ): this {
    if (event === "data") {
      this.dataListeners.push(listener);
      return this;
    }
    this.errorListeners.push(listener);
    return this;
  }

  destroy(): void {
    this.destroyed = true;
  }

  emitData(chunk: Uint8Array): void {
    for (const listener of this.dataListeners) listener(chunk);
  }

  emitError(error: Error): void {
    for (const listener of this.errorListeners) listener(error);
  }
}

class FakeReceiver implements VoiceReceiverLike {
  readonly subscribeCalls: string[] = [];
  readonly streams = new Map<string, FakeStream>();
  private readonly startListeners: ((userId: string) => void)[] = [];
  readonly speaking = {
    on: (_event: "start", listener: (userId: string) => void) => {
      this.startListeners.push(listener);
      return this.speaking;
    },
  };

  subscribe(userId: string): FakeStream {
    this.subscribeCalls.push(userId);
    const stream = new FakeStream();
    this.streams.set(userId, stream);
    return stream;
  }

  emitSpeakingStart(userId: string): void {
    for (const listener of this.startListeners) listener(userId);
  }
}

function bridgeHarness(options?: {
  isHumanUser?: (userId: string) => boolean;
}) {
  const receiver = new FakeReceiver();
  const accepted: VoiceAudioInput[] = [];
  const bridge = new VoiceReceiverBridge({
    receiver,
    accept: (audio) => {
      accepted.push(audio);
    },
    isHumanUser: options?.isHumanUser ?? (() => true),
  });
  return { receiver, accepted, bridge };
}

describe("VoiceReceiverBridge", () => {
  test("subscribes one stream per speaker and forwards packets", () => {
    const { receiver, accepted } = bridgeHarness();
    receiver.emitSpeakingStart("user-1");
    receiver.emitSpeakingStart("user-1");
    receiver.emitSpeakingStart("user-1");
    expect(receiver.subscribeCalls).toEqual(["user-1"]);
    receiver.streams.get("user-1")?.emitData(new Uint8Array([1, 2, 3]));
    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.userId).toBe("user-1");
    expect(accepted[0]?.opus).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("never subscribes bot users", () => {
    const { receiver } = bridgeHarness({
      isHumanUser: (userId) => userId !== "bot-1",
    });
    receiver.emitSpeakingStart("bot-1");
    receiver.emitSpeakingStart("user-2");
    expect(receiver.subscribeCalls).toEqual(["user-2"]);
  });

  test("drops a failed stream and resubscribes on the next speech", () => {
    const { receiver, bridge } = bridgeHarness();
    receiver.emitSpeakingStart("user-1");
    const first = receiver.streams.get("user-1");
    first?.emitError(new Error("packet decrypt failed"));
    expect(first?.destroyed).toBe(true);
    expect(bridge.subscribedUserIds).toEqual([]);
    receiver.emitSpeakingStart("user-1");
    expect(receiver.subscribeCalls).toEqual(["user-1", "user-1"]);
  });

  test("close destroys every stream and refuses new audio", () => {
    const { receiver, accepted, bridge } = bridgeHarness();
    receiver.emitSpeakingStart("user-1");
    receiver.emitSpeakingStart("user-2");
    const stream = receiver.streams.get("user-1");
    bridge.close();
    expect([...receiver.streams.values()].every((s) => s.destroyed)).toBe(true);
    stream?.emitData(new Uint8Array([9]));
    receiver.emitSpeakingStart("user-3");
    expect(accepted).toHaveLength(0);
    expect(receiver.subscribeCalls).toEqual(["user-1", "user-2"]);
  });
});
