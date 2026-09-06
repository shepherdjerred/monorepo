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

/**
 * Flush microtasks until `condition` holds. `enqueuePerKey`'s chaining is
 * plain promise composition with no fake timers to advance, and a queued
 * task's own async work can land an unpredictable number of microtask hops
 * after the promise that unblocked it — so tests wait for the actual effect
 * instead of asserting a specific tick count.
 */
async function waitUntil(
  condition: () => boolean,
  maxTicks = 50,
): Promise<void> {
  for (let tick = 0; tick < maxTicks && !condition(); tick++) {
    await Promise.resolve();
  }
  if (!condition()) {
    throw new Error("waitUntil: condition never became true");
  }
}

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

type GateResult = { volumeMultiplier: number; release: () => void };

/** A playback gate whose completion the test controls. */
function deferredGate() {
  const state: { resolve: (value: GateResult) => void } = {
    resolve: doNothing,
  };
  const promise = new Promise<GateResult>((resolve) => {
    state.resolve = resolve;
  });
  return {
    promise,
    // Resolves the gate promise (lets the alert past the wait) — distinct
    // from the resolved value's own `release`, which is what the alert
    // calls once ITS playback ends to free the connection reservation.
    resolveGate: () => {
      state.resolve({ volumeMultiplier: 1, release: doNothing });
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

  test("ensureConnected and an assistant joinChannel never race establish() on a brand-new guild", async () => {
    const releases: (() => void)[] = [];
    let establishCalls = 0;
    const establish: EstablishVoiceConnection<FakeConnection> = ({
      channelId,
      selfDeaf,
    }) =>
      new Promise((resolve) => {
        establishCalls += 1;
        releases.push(() => {
          resolve(new FakeConnection(channelId, selfDeaf));
        });
      });
    const manager = new VoiceManager<FakeConnection>(establish);
    manager.setClient(new Client({ intents: [GatewayIntentBits.Guilds] }));

    // No connection exists yet for this guild: an alert's ensureConnected and
    // an assistant /scout join race for the very first connection. Without
    // serializing establish() per guild, both would see "nothing connected"
    // and each call establish(), with the second silently overwriting (and
    // leaking) whichever the first created.
    const assistantJoin = manager.joinChannel(
      GUILD,
      "voice-channel",
      "assistant",
    );
    const alertConnect = manager.ensureConnected(GUILD, "alert-channel");

    // Only the queued (first) attempt has reached establish() so far.
    expect(establishCalls).toBe(1);
    releases[0]?.();
    const assistantConnection = await assistantJoin;
    // The alert's turn now runs, sees the assistant connection already in
    // place, and reuses it without ever calling establish() again.
    const alertConnection = await alertConnect;
    expect(establishCalls).toBe(1);
    expect(alertConnection).toBe(assistantConnection);
    expect(manager.getConnectionMode(GUILD)).toBe("assistant");
  });

  test("a playback ensureConnected first still lets a later assistant join take over cleanly", async () => {
    const releases: (() => void)[] = [];
    let establishCalls = 0;
    const establish: EstablishVoiceConnection<FakeConnection> = ({
      channelId,
      selfDeaf,
    }) =>
      new Promise((resolve) => {
        establishCalls += 1;
        releases.push(() => {
          resolve(new FakeConnection(channelId, selfDeaf));
        });
      });
    const manager = new VoiceManager<FakeConnection>(establish);
    manager.setClient(new Client({ intents: [GatewayIntentBits.Guilds] }));

    const alertConnect = manager.ensureConnected(GUILD, "alert-channel");
    const assistantJoin = manager.joinChannel(
      GUILD,
      "voice-channel",
      "assistant",
    );

    expect(establishCalls).toBe(1);
    releases[0]?.();
    const playbackConnection = await alertConnect;
    // The queued assistant task's own establish() call happens as a later
    // microtask continuation, not necessarily before `await alertConnect`
    // resumes here — wait for it rather than asserting an exact tick count.
    await waitUntil(() => establishCalls === 2);
    releases[1]?.();
    const assistantConnection = await assistantJoin;
    // The assistant join runs only after the playback connection is fully
    // in place, so it correctly destroys-and-replaces it (an explicit
    // /scout join always may move the bot) instead of racing it.
    expect(establishCalls).toBe(2);
    expect(playbackConnection.destroyed).toBe(true);
    expect(manager.getConnection(GUILD)).toBe(assistantConnection);
    expect(manager.getConnectionMode(GUILD)).toBe("assistant");
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
    gate.resolveGate();
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
    gate.resolveGate();
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
    gate.resolveGate();
    await expect(blocked).resolves.toBe("g1");
  });
});
