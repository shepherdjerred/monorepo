import { describe, expect, test } from "vitest";
import { VoiceConnectionStatus, type AudioPlayer } from "@discordjs/voice";
import { Client, GatewayIntentBits } from "discord.js";
import {
  enqueuePerKey,
  VoiceManager,
  type EstablishVoiceConnection,
  type VoiceManagerConnection,
} from "#src/voice/voice-manager.ts";

const GUILD = "100000000000000001";

class FakeConnection implements VoiceManagerConnection {
  destroyed = false;
  subscribed: AudioPlayer[] = [];
  status: VoiceConnectionStatus = VoiceConnectionStatus.Ready;
  constructor(
    readonly channelId: string,
    readonly selfDeaf: boolean,
  ) {}

  get state(): { status: VoiceConnectionStatus } {
    return { status: this.status };
  }

  destroy(): void {
    this.destroyed = true;
    this.status = VoiceConnectionStatus.Destroyed;
  }

  subscribe(player: AudioPlayer): unknown {
    this.subscribed.push(player);
    return undefined;
  }
}

type Harness = {
  manager: VoiceManager<FakeConnection>;
  established: FakeConnection[];
  lost: { guildId: string; mode: string }[];
  loseConnection: (connection: FakeConnection) => void;
};

function managerHarness(): Harness {
  const established: FakeConnection[] = [];
  const lost: { guildId: string; mode: string }[] = [];
  const lostCallbacks = new Map<FakeConnection, () => void>();
  const establish: EstablishVoiceConnection<FakeConnection> = ({
    channelId,
    selfDeaf,
    onConnectionLost,
  }) => {
    const connection = new FakeConnection(channelId, selfDeaf);
    established.push(connection);
    lostCallbacks.set(connection, onConnectionLost);
    return Promise.resolve(connection);
  };
  const manager = new VoiceManager<FakeConnection>(establish);
  manager.onConnectionLost((guildId, mode) => {
    lost.push({ guildId, mode });
  });
  // The client is only dereferenced for null checks in the tested paths.
  manager.setClient(new Client({ intents: [GatewayIntentBits.Guilds] }));
  return {
    manager,
    established,
    lost,
    loseConnection: (connection) => {
      lostCallbacks.get(connection)?.();
    },
  };
}

/** A playback gate whose completion the test controls. */
function deferredGate() {
  const state: { resolve: (value: { volumeMultiplier: number }) => void } = {
    resolve: doNothing,
  };
  const promise = new Promise<{ volumeMultiplier: number }>((resolve) => {
    state.resolve = resolve;
  });
  return {
    promise,
    release: () => {
      state.resolve({ volumeMultiplier: 1 });
    },
  };
}

function doNothing(): void {
  /* replaced synchronously by the Promise constructor */
}

describe("VoiceManager modes", () => {
  test("playback joins deafened, assistant joins undeafened", async () => {
    const h = managerHarness();
    const playback = await h.manager.joinChannel(GUILD, "alerts");
    expect(playback.selfDeaf).toBe(true);
    expect(h.manager.getConnectionMode(GUILD)).toBe("playback");

    const assistant = await h.manager.joinChannel(GUILD, "voice", "assistant");
    expect(assistant.selfDeaf).toBe(false);
    expect(h.manager.getConnectionMode(GUILD)).toBe("assistant");
    // The explicit assistant join replaced the playback connection.
    expect(playback.destroyed).toBe(true);
  });

  test("ensureConnected never destroys an active assistant connection", async () => {
    const h = managerHarness();
    const assistant = await h.manager.joinChannel(GUILD, "voice", "assistant");
    const forAlert = await h.manager.ensureConnected(GUILD, "other-channel");
    expect(forAlert).toBe(assistant);
    expect(assistant.destroyed).toBe(false);
    expect(h.established).toHaveLength(1);
  });

  test("a playback joinChannel bounces off an active assistant connection", async () => {
    const h = managerHarness();
    const assistant = await h.manager.joinChannel(GUILD, "voice", "assistant");
    const playback = await h.manager.joinChannel(GUILD, "alerts", "playback");
    expect(playback).toBe(assistant);
    expect(assistant.destroyed).toBe(false);
  });

  test("leaving clears the mode so the next join is deafened playback", async () => {
    const h = managerHarness();
    await h.manager.joinChannel(GUILD, "voice", "assistant");
    h.manager.leaveChannel(GUILD);
    expect(h.manager.getConnectionMode(GUILD)).toBeUndefined();
    const next = await h.manager.ensureConnected(GUILD, "alerts");
    expect(next.selfDeaf).toBe(true);
    expect(h.manager.getConnectionMode(GUILD)).toBe("playback");
  });

  test("ensureConnected reuses a ready playback connection", async () => {
    const h = managerHarness();
    const first = await h.manager.ensureConnected(GUILD, "alerts");
    const second = await h.manager.ensureConnected(GUILD, "alerts");
    expect(second).toBe(first);
    expect(h.established).toHaveLength(1);
  });

  test("connection loss reports the mode and forgets the guild", async () => {
    const h = managerHarness();
    const assistant = await h.manager.joinChannel(GUILD, "voice", "assistant");
    h.loseConnection(assistant);
    expect(h.lost).toEqual([{ guildId: GUILD, mode: "assistant" }]);
    expect(h.manager.getConnection(GUILD)).toBeUndefined();
    expect(h.manager.getConnectionMode(GUILD)).toBeUndefined();
  });

  test("an alert held by the playback gate never plays into a torn-down connection", async () => {
    const h = managerHarness();
    const assistant = await h.manager.joinChannel(GUILD, "voice", "assistant");
    const gate = deferredGate();
    h.manager.setPlaybackGate(() => gate.promise);
    const alert = h.manager.playSound(GUILD, {
      type: "url",
      url: "https://example.invalid/alert.mp3",
    });
    // The session ends while the gate holds the alert.
    h.manager.leaveChannel(GUILD);
    gate.release();
    await expect(alert).rejects.toThrow("No voice connection");
    // Nothing was subscribed to the destroyed connection after teardown.
    expect(assistant.subscribed).toEqual([]);
  });

  test("a stale connection's loss callback cannot forget its replacement", async () => {
    const h = managerHarness();
    const first = await h.manager.joinChannel(GUILD, "voice", "assistant");
    const second = await h.manager.joinChannel(GUILD, "voice", "assistant");
    h.loseConnection(first);
    expect(h.lost).toEqual([]);
    expect(h.manager.getConnection(GUILD)).toBe(second);
  });
});

describe("enqueuePerKey", () => {
  test("runs tasks for one key strictly in order", async () => {
    const queues = new Map<string, Promise<unknown>>();
    const order: string[] = [];
    const gate = deferredGate();
    const first = enqueuePerKey(queues, "g1", async () => {
      order.push("first-start");
      await gate.promise;
      order.push("first-end");
    });
    const second = enqueuePerKey(queues, "g1", async () => {
      order.push("second-start");
    });
    expect(order).toEqual(["first-start"]);
    gate.release();
    await first;
    await second;
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
  });

  test("a failed task rejects its caller without poisoning the queue", async () => {
    const queues = new Map<string, Promise<unknown>>();
    const failing = enqueuePerKey(queues, "g1", () =>
      Promise.reject(new Error("alert failed")),
    );
    await expect(failing).rejects.toThrow("alert failed");
    await expect(
      enqueuePerKey(queues, "g1", () => Promise.resolve("ok")),
    ).resolves.toBe("ok");
    expect(queues.size).toBe(0);
  });

  test("keys queue independently", async () => {
    const queues = new Map<string, Promise<unknown>>();
    const gate = deferredGate();
    const blocked = enqueuePerKey(queues, "g1", async () => {
      await gate.promise;
      return "g1";
    });
    await expect(
      enqueuePerKey(queues, "g2", () => Promise.resolve("g2")),
    ).resolves.toBe("g2");
    gate.release();
    await expect(blocked).resolves.toBe("g1");
  });
});
