import { describe, expect, test } from "vitest";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import {
  VoiceAssistantManager,
  type AssistantConnection,
  type VoiceAssistantManagerDeps,
} from "#src/voice-assistant/manager.ts";
import type { VoiceAssistantRuntime } from "#src/voice-assistant/runtime.ts";
import type { ConnectionMode } from "#src/voice/voice-manager.ts";
import { fakeLocalVoiceModels } from "#src/voice-assistant/test-helpers.ts";

const GUILD = DiscordGuildIdSchema.parse("100000000000000001");

/**
 * Flush microtasks until `condition` holds. `performJoin` now awaits an
 * eligibility check (flag + occupancy) before it ever reaches
 * `joinAssistantChannel`, so a fake connection factory that pushes
 * synchronously is no longer guaranteed to have been called by the time a
 * test's own synchronous code finishes — wait for the actual effect instead
 * of assuming a fixed number of ticks.
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

const FAKE_RUNTIME: VoiceAssistantRuntime = {
  models: fakeLocalVoiceModels(),
  feedbackClips: { retry: new Uint8Array(), prompt: new Uint8Array() },
  openAiApiKey: "test-key",
};

function fakeConnection(): AssistantConnection {
  return {
    setSpeaking: () => null,
    playOpusPacket: () => null,
    receiver: {
      speaking: {
        on: () => null,
      },
      subscribe: () => ({
        on: () => null,
        destroy: () => {
          /* fake */
        },
      }),
    },
  };
}

type FakeTimer = { fire: () => void; cancelled: boolean };

type Harness = {
  manager: VoiceAssistantManager;
  timers: FakeTimer[];
  left: string[];
  sessionEvents: string[];
  wakeAccepted: (() => void) | undefined;
  /**
   * Sets occupancy for `channelId`, or the default every OTHER channel
   * falls back to when omitted — `countHumanMembers` is channel-scoped in
   * production, so tests that need two channels to disagree (e.g. one
   * request's target empties while another's does not) pass a channelId.
   */
  setHumanCount: (count: number | null, channelId?: string) => void;
  setGuildEnabled: (enabled: boolean) => void;
  /**
   * Queues one-shot results (consumed in order, oldest first) for the next
   * calls to `isGuildEnabled`, falling back to the plain `guildEnabled`
   * state once the queue drains. An `Error` makes that call reject, so
   * tests can target either the starting flag recheck or the
   * post-connection one (`isJoinStillEligible`) independently.
   */
  queueGuildEnabledResult: (result: boolean | Error) => void;
  fireConnectionLost: (guildId: string, mode: ConnectionMode) => void;
};

function managerHarness(options?: {
  joinAssistantChannel?: VoiceAssistantManagerDeps["joinAssistantChannel"];
}): Harness {
  const timers: FakeTimer[] = [];
  const left: string[] = [];
  const sessionEvents: string[] = [];
  const state: {
    wakeAccepted: (() => void) | undefined;
    defaultHumanCount: number | null;
    humanCountsByChannel: Map<string, number | null>;
    guildEnabled: boolean;
    guildEnabledQueue: (boolean | Error)[];
    connectionLost:
      ((guildId: string, mode: ConnectionMode) => void) | undefined;
  } = {
    wakeAccepted: undefined,
    defaultHumanCount: 1,
    humanCountsByChannel: new Map(),
    guildEnabled: true,
    guildEnabledQueue: [],
    connectionLost: undefined,
  };
  const deps: VoiceAssistantManagerDeps = {
    runtime: () => FAKE_RUNTIME,
    joinAssistantChannel:
      options?.joinAssistantChannel ??
      (() => Promise.resolve(fakeConnection())),
    leaveChannel: (guildId) => {
      left.push(guildId);
    },
    onConnectionLost: (listener) => {
      state.connectionLost = listener;
    },
    isHumanUser: () => true,
    countHumanMembers: (_guildId, channelId) =>
      state.humanCountsByChannel.get(channelId) ?? state.defaultHumanCount,
    createSession: (input) => {
      state.wakeAccepted = input.onWakeAccepted;
      sessionEvents.push("created");
      return {
        accept: () => {
          /* fake */
        },
        abortActiveTransaction: (reason) => {
          sessionEvents.push(`aborted:${reason}`);
        },
        close: () => {
          sessionEvents.push("closed");
        },
      };
    },
    setTimer: (callback) => {
      const timer: FakeTimer = {
        fire: callback,
        cancelled: false,
      };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    captureQuestion: () => {
      /* covered by analytics tests */
    },
    isGuildEnabled: () => {
      const queued = state.guildEnabledQueue.shift();
      if (queued instanceof Error) return Promise.reject(queued);
      return Promise.resolve(queued ?? state.guildEnabled);
    },
  };
  const manager = new VoiceAssistantManager(deps);
  return {
    manager,
    timers,
    left,
    sessionEvents,
    get wakeAccepted() {
      return state.wakeAccepted;
    },
    setHumanCount: (count, channelId) => {
      if (channelId === undefined) {
        state.defaultHumanCount = count;
        return;
      }
      state.humanCountsByChannel.set(channelId, count);
    },
    setGuildEnabled: (enabled) => {
      state.guildEnabled = enabled;
    },
    queueGuildEnabledResult: (result) => {
      state.guildEnabledQueue.push(result);
    },
    fireConnectionLost: (guildId, mode) => {
      state.connectionLost?.(guildId, mode);
    },
  };
}

function pendingConnectionHarness(): {
  readonly h: Harness;
  readonly pendingConnections: ((connection: AssistantConnection) => void)[];
} {
  const pendingConnections: ((connection: AssistantConnection) => void)[] = [];
  return {
    h: managerHarness({
      joinAssistantChannel: () =>
        new Promise((resolve) => {
          pendingConnections.push(resolve);
        }),
    }),
    pendingConnections,
  };
}

async function expectPendingJoinCancelled(
  h: Harness,
  pendingConnections: readonly ((connection: AssistantConnection) => void)[],
  join: Promise<string>,
): Promise<void> {
  pendingConnections[0]?.(fakeConnection());
  await expect(join).resolves.toBe("cancelled");
  expect(h.manager.isActive(GUILD)).toBe(false);
  expect(h.left).toEqual([GUILD]);
  expect(h.sessionEvents).not.toContain("created");
}

describe("VoiceAssistantManager", () => {
  test("join starts a session and arms the inactivity timer", async () => {
    const h = managerHarness();
    await h.manager.join(GUILD, "channel-1");
    expect(h.manager.isActive(GUILD)).toBe(true);
    expect(h.manager.activeChannelId(GUILD)).toBe("channel-1");
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]?.cancelled).toBe(false);
  });

  test("the inactivity timer tears the session down and leaves", async () => {
    const h = managerHarness();
    await h.manager.join(GUILD, "channel-1");
    h.timers[0]?.fire();
    expect(h.manager.isActive(GUILD)).toBe(false);
    expect(h.left).toEqual([GUILD]);
    expect(h.sessionEvents).toContain("closed");
  });

  test("an accepted wake re-arms the inactivity timer", async () => {
    const h = managerHarness();
    await h.manager.join(GUILD, "channel-1");
    h.wakeAccepted?.();
    expect(h.timers).toHaveLength(2);
    expect(h.timers[0]?.cancelled).toBe(true);
    expect(h.timers[1]?.cancelled).toBe(false);
    // Only the live timer may end the session.
    h.timers[1]?.fire();
    expect(h.manager.isActive(GUILD)).toBe(false);
  });

  test("voiceStateUpdate tears down only when the channel has no humans", async () => {
    const h = managerHarness();
    await h.manager.join(GUILD, "channel-1");
    h.setHumanCount(2);
    h.manager.handleVoiceStateUpdate(GUILD);
    expect(h.manager.isActive(GUILD)).toBe(true);
    h.setHumanCount(null);
    h.manager.handleVoiceStateUpdate(GUILD);
    expect(h.manager.isActive(GUILD)).toBe(true);
    h.setHumanCount(0);
    h.manager.handleVoiceStateUpdate(GUILD);
    expect(h.manager.isActive(GUILD)).toBe(false);
    expect(h.left).toEqual([GUILD]);
  });

  test("voiceStateUpdate for a guild without a session is a no-op", () => {
    const h = managerHarness();
    h.setHumanCount(0);
    h.manager.handleVoiceStateUpdate(GUILD);
    expect(h.left).toEqual([]);
  });

  test("leave closes the session exactly once", async () => {
    const h = managerHarness();
    await h.manager.join(GUILD, "channel-1");
    expect(h.manager.leave(GUILD)).toBe(true);
    expect(h.manager.leave(GUILD)).toBe(false);
    expect(h.left).toEqual([GUILD]);
    expect(h.sessionEvents.filter((event) => event === "closed")).toHaveLength(
      1,
    );
  });

  test("rejoining moves the session without a spurious channel leave", async () => {
    const h = managerHarness();
    await h.manager.join(GUILD, "channel-1");
    await h.manager.join(GUILD, "channel-2");
    expect(h.manager.activeChannelId(GUILD)).toBe("channel-2");
    // The old session closed, but the voice connection replacement is the
    // voice manager's job — no explicit leave happened in between.
    expect(h.left).toEqual([]);
    expect(h.sessionEvents.filter((event) => event === "created")).toHaveLength(
      2,
    );
  });

  test("an assistant connection loss ends the session without re-leaving", async () => {
    const h = managerHarness();
    await h.manager.join(GUILD, "channel-1");
    h.fireConnectionLost(GUILD, "assistant");
    expect(h.manager.isActive(GUILD)).toBe(false);
    expect(h.left).toEqual([]);
  });

  test("a playback connection loss never touches voice sessions", async () => {
    const h = managerHarness();
    await h.manager.join(GUILD, "channel-1");
    h.fireConnectionLost(GUILD, "playback");
    expect(h.manager.isActive(GUILD)).toBe(true);
  });

  test("concurrent joins serialize instead of stranding the first session", async () => {
    const { h, pendingConnections } = pendingConnectionHarness();
    const first = h.manager.join(GUILD, "channel-1");
    const second = h.manager.join(GUILD, "channel-2");
    // Only the first join has reached the connection step; the second is
    // queued behind it rather than racing past the "no session" check.
    await waitUntil(() => pendingConnections.length === 1);
    pendingConnections[0]?.(fakeConnection());
    await first;
    await waitUntil(() => pendingConnections.length === 2);
    pendingConnections[1]?.(fakeConnection());
    await second;
    // The first session was properly ended (not stranded) and exactly one
    // live timer remains, belonging to the second session.
    expect(h.manager.activeChannelId(GUILD)).toBe("channel-2");
    expect(h.sessionEvents.filter((event) => event === "created")).toHaveLength(
      2,
    );
    expect(h.sessionEvents.filter((event) => event === "closed")).toHaveLength(
      1,
    );
    expect(h.timers.filter((timer) => !timer.cancelled)).toHaveLength(1);
  });

  test("switching the guild flag off ends its live session", async () => {
    const h = managerHarness();
    await h.manager.join(GUILD, "channel-1");
    await h.manager.closeDisabledGuildSessions();
    expect(h.manager.isActive(GUILD)).toBe(true);
    h.setGuildEnabled(false);
    await h.manager.closeDisabledGuildSessions();
    expect(h.manager.isActive(GUILD)).toBe(false);
    expect(h.left).toEqual([GUILD]);
    expect(h.sessionEvents).toContain("closed");
  });
});

describe("VoiceAssistantManager pending-join cancellation", () => {
  test("leave() during an in-flight join cancels it before it can start listening", async () => {
    const { h, pendingConnections } = pendingConnectionHarness();
    const join = h.manager.join(GUILD, "channel-1");
    // /scout leave arrives while the connection is still establishing;
    // nothing is active yet, so the immediate reply is "not in a channel" —
    // but the join itself must still be prevented from starting to listen.
    expect(h.manager.leave(GUILD)).toBe(false);
    await expectPendingJoinCancelled(h, pendingConnections, join);
  });

  test("a flag-disable sweep cancels a pending join in that guild", async () => {
    const { h, pendingConnections } = pendingConnectionHarness();
    const join = h.manager.join(GUILD, "channel-1");
    h.setGuildEnabled(false);
    await h.manager.closeDisabledGuildSessions();
    await expectPendingJoinCancelled(h, pendingConnections, join);
  });

  test("performJoin's own flag recheck catches a disable the sweep never saw", async () => {
    const { h, pendingConnections } = pendingConnectionHarness();
    const join = h.manager.join(GUILD, "channel-1");
    // The flag turns off while this request is queued/establishing, and no
    // closeDisabledGuildSessions() sweep ever runs — a sweep snapshots
    // sessions/joinQueues at the moment it runs, so a join that entered
    // joinQueues after the last sweep tick (or before flag-disable happens
    // to align with one) is invisible to it. Only performJoin's own
    // recheck can catch this.
    h.setGuildEnabled(false);
    await waitUntil(() => pendingConnections.length === 1);
    await expectPendingJoinCancelled(h, pendingConnections, join);
  });

  test("shutdown cancels a pending join", async () => {
    const { h, pendingConnections } = pendingConnectionHarness();
    const join = h.manager.join(GUILD, "channel-1");
    h.manager.closeAll();
    await expectPendingJoinCancelled(h, pendingConnections, join);
  });

  test('join() resolves "joined" on success', async () => {
    const h = managerHarness();
    await expect(h.manager.join(GUILD, "channel-1")).resolves.toBe("joined");
  });

  test("a join requested after shutdown is refused without ever attempting a connection", async () => {
    const h = managerHarness();
    await h.manager.join(GUILD, "channel-1");
    h.manager.closeAll();
    expect(h.manager.isActive(GUILD)).toBe(false);
    // A command that arrives during the rest of process shutdown — while
    // Discord is still connected — must never start a brand new session.
    await expect(h.manager.join(GUILD, "channel-2")).resolves.toBe("cancelled");
    expect(h.manager.isActive(GUILD)).toBe(false);
    expect(h.sessionEvents.filter((event) => event === "created")).toHaveLength(
      1,
    );
  });

  test("a join queued behind an in-flight one is cancelled too when a stop arrives first", async () => {
    const { h, pendingConnections } = pendingConnectionHarness();
    const first = h.manager.join(GUILD, "channel-1");
    const second = h.manager.join(GUILD, "channel-2");
    // Only the first has reached the connection step; the second is queued
    // behind it and has not attempted to establish anything yet.
    await waitUntil(() => pendingConnections.length === 1);
    // A stop arrives while the first is still establishing and before the
    // second has even started its own attempt.
    h.manager.leave(GUILD);
    pendingConnections[0]?.(fakeConnection());
    await expect(first).resolves.toBe("cancelled");
    // The second must ALSO be cancelled — it predates the stop, even though
    // it never itself attempted a connection. Without capturing the epoch at
    // enqueue time, this request would start "fresh" once its turn came up
    // and never notice the intervening leave.
    await expect(second).resolves.toBe("cancelled");
    expect(pendingConnections).toHaveLength(1);
    expect(h.sessionEvents).not.toContain("created");
  });

  test("an in-flight join is cancelled when its target channel empties before the connection is ready", async () => {
    const { h, pendingConnections } = pendingConnectionHarness();
    const join = h.manager.join(GUILD, "channel-1");
    // The requester (or everyone) leaves the target channel while Discord is
    // still finishing the handshake — no session exists yet for the
    // realized-session branch of handleVoiceStateUpdate to catch this.
    h.setHumanCount(0);
    h.manager.handleVoiceStateUpdate(GUILD);
    await expectPendingJoinCancelled(h, pendingConnections, join);
  });

  test("handleVoiceStateUpdate leaves a pending join alone while its channel still has humans", async () => {
    const { h, pendingConnections } = pendingConnectionHarness();
    const join = h.manager.join(GUILD, "channel-1");
    h.setHumanCount(2);
    h.manager.handleVoiceStateUpdate(GUILD);
    await waitUntil(() => pendingConnections.length === 1);
    pendingConnections[0]?.(fakeConnection());
    await expect(join).resolves.toBe("joined");
  });

  test("a queued join to a different channel revalidates occupancy when its own turn comes", async () => {
    const { h, pendingConnections } = pendingConnectionHarness();
    const first = h.manager.join(GUILD, "channel-1");
    const second = h.manager.join(GUILD, "channel-2");
    // Channel-2 (the SECOND, still-queued request's target) empties out
    // while the first request is establishing; channel-1 (the first's own
    // target) still has people throughout. `pendingJoinChannels` only names
    // channel-1 at this point (the first request is the one actually
    // establishing), so a reactive `handleVoiceStateUpdate` firing here
    // would target the wrong channel entirely — only revalidating at the
    // moment the second request itself reaches the head of the queue can
    // catch this.
    h.setHumanCount(0, "channel-2");
    await waitUntil(() => pendingConnections.length === 1);
    pendingConnections[0]?.(fakeConnection());
    await expect(first).resolves.toBe("joined");
    await expect(second).resolves.toBe("cancelled");
    // The cancelled second request never attempted its own connection, and
    // — critically — never tore down the first, still-valid session either.
    expect(pendingConnections).toHaveLength(1);
    expect(h.manager.activeChannelId(GUILD)).toBe("channel-1");
  });

  test("a join proceeds normally when its target channel already has humans", async () => {
    const h = managerHarness();
    h.setHumanCount(3);
    await expect(h.manager.join(GUILD, "channel-1")).resolves.toBe("joined");
  });
});

describe("VoiceAssistantManager flag-evaluation failures and external epochs", () => {
  test("fails closed when the starting flag recheck cannot be evaluated", async () => {
    const h = managerHarness();
    h.queueGuildEnabledResult(new Error("provider broke"));
    await expect(h.manager.join(GUILD, "channel-1")).resolves.toBe("cancelled");
    expect(h.manager.isActive(GUILD)).toBe(false);
    expect(h.left).toEqual([GUILD]);
    expect(h.sessionEvents).not.toContain("created");
  });

  test("join() cancels immediately when a caller-supplied epoch is already stale", async () => {
    const h = managerHarness();
    // Simulates the pre-`join()` gap in scout-voice.ts: capture the epoch,
    // then something ends the guild's session (here, a bare leave() with no
    // active session) before `join()` is ever called.
    const capturedEpoch = h.manager.captureJoinEpoch(GUILD);
    h.manager.leave(GUILD);
    await expect(
      h.manager.join(GUILD, "channel-1", capturedEpoch),
    ).resolves.toBe("cancelled");
    expect(h.manager.isActive(GUILD)).toBe(false);
    expect(h.sessionEvents).not.toContain("created");
    // Nothing was committed to by this attempt, so there is nothing to
    // leave — unlike the checks inside performJoin.
    expect(h.left).toEqual([]);
  });

  test("join() proceeds normally when the caller-supplied epoch still matches", async () => {
    const h = managerHarness();
    const capturedEpoch = h.manager.captureJoinEpoch(GUILD);
    await expect(
      h.manager.join(GUILD, "channel-1", capturedEpoch),
    ).resolves.toBe("joined");
  });

  test("fails closed when the post-connection flag recheck cannot be evaluated", async () => {
    const { h, pendingConnections } = pendingConnectionHarness();
    // The starting recheck succeeds; only the recheck after the connection
    // resolves fails to evaluate.
    h.queueGuildEnabledResult(true);
    h.queueGuildEnabledResult(new Error("provider broke"));
    const join = h.manager.join(GUILD, "channel-1");
    await waitUntil(() => pendingConnections.length === 1);
    await expectPendingJoinCancelled(h, pendingConnections, join);
  });
});

describe("VoiceAssistantManager handleBotChannelChanged", () => {
  test("ends an active session when Scout is moved to a different channel", async () => {
    const h = managerHarness();
    await h.manager.join(GUILD, "channel-1");
    h.manager.handleBotChannelChanged(GUILD, "channel-2");
    expect(h.manager.isActive(GUILD)).toBe(false);
    expect(h.left).toEqual([GUILD]);
    expect(h.sessionEvents).toContain("closed");
  });

  test("is a no-op when the reported channel matches the active one", async () => {
    const h = managerHarness();
    await h.manager.join(GUILD, "channel-1");
    h.manager.handleBotChannelChanged(GUILD, "channel-1");
    expect(h.manager.isActive(GUILD)).toBe(true);
    expect(h.left).toEqual([]);
  });

  test("does nothing for a guild with no active or pending session", () => {
    const h = managerHarness();
    h.manager.handleBotChannelChanged(GUILD, "channel-2");
    expect(h.left).toEqual([]);
  });

  test("cancels a pending join when Scout is moved before the connection resolves", async () => {
    const pendingConnections: ((connection: AssistantConnection) => void)[] =
      [];
    const h = managerHarness({
      joinAssistantChannel: () =>
        new Promise((resolve) => {
          pendingConnections.push(resolve);
        }),
    });
    const join = h.manager.join(GUILD, "channel-1");
    await waitUntil(() => pendingConnections.length === 1);
    // Scout gets dragged to a different channel while the first connection
    // is still establishing — a stray VoiceStateUpdate for the bot itself,
    // not anything routed through join()/leave().
    h.manager.handleBotChannelChanged(GUILD, "channel-3");
    pendingConnections[0]?.(fakeConnection());
    await expect(join).resolves.toBe("cancelled");
    expect(h.sessionEvents).not.toContain("created");
  });

  test("does not cancel a join over its own manager-initiated null transition", async () => {
    const pendingConnections: ((connection: AssistantConnection) => void)[] =
      [];
    const h = managerHarness({
      joinAssistantChannel: () =>
        new Promise((resolve) => {
          pendingConnections.push(resolve);
        }),
    });
    const join = h.manager.join(GUILD, "channel-1");
    await waitUntil(() => pendingConnections.length === 1);
    // `join()` always destroys any existing connection before establishing
    // the requested one, which briefly reports no channel while the old
    // connection tears down — a transient `null`, not an external move.
    h.manager.handleBotChannelChanged(GUILD, null);
    pendingConnections[0]?.(fakeConnection());
    await expect(join).resolves.toBe("joined");
    expect(h.sessionEvents).toContain("created");
  });

  test("does not end an active session on a null transition", async () => {
    const h = managerHarness();
    await h.manager.join(GUILD, "channel-1");
    // A genuine full disconnect is the connection-lost listener's job, not
    // this one's.
    h.manager.handleBotChannelChanged(GUILD, null);
    expect(h.manager.isActive(GUILD)).toBe(true);
    expect(h.left).toEqual([]);
  });
});
