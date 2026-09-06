import { describe, expect, test } from "vitest";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import {
  VoiceAssistantManager,
  type AssistantConnection,
  type VoiceAssistantManagerDeps,
} from "#src/voice-assistant/manager.ts";
import type { VoiceAssistantRuntime } from "#src/voice-assistant/runtime.ts";
import type { ConnectionMode } from "#src/voice/voice-manager.ts";

const GUILD = DiscordGuildIdSchema.parse("100000000000000001");

const FAKE_RUNTIME: VoiceAssistantRuntime = {
  models: {
    runtime: "native",
    createKeywordDetector: () => ({
      accept: () => null,
      reset: () => {
        /* fake */
      },
      close: () => {
        /* fake */
      },
    }),
    createVad: () => ({
      accept: () => {
        /* fake */
      },
      isSpeechActive: () => false,
      hasCompletedSpeech: () => false,
      flush: () => {
        /* fake */
      },
      reset: () => {
        /* fake */
      },
      close: () => {
        /* fake */
      },
    }),
    verifyWakePhrase: () => Promise.resolve({ accepted: false, score: 0 }),
    close: () => Promise.resolve(),
  },
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
  setHumanCount: (count: number | null) => void;
  setGuildEnabled: (enabled: boolean) => void;
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
    humanCount: number | null;
    guildEnabled: boolean;
    connectionLost:
      ((guildId: string, mode: ConnectionMode) => void) | undefined;
  } = {
    wakeAccepted: undefined,
    humanCount: 1,
    guildEnabled: true,
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
    countHumanMembers: () => state.humanCount,
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
    isGuildEnabled: () => Promise.resolve(state.guildEnabled),
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
    setHumanCount: (count) => {
      state.humanCount = count;
    },
    setGuildEnabled: (enabled) => {
      state.guildEnabled = enabled;
    },
    fireConnectionLost: (guildId, mode) => {
      state.connectionLost?.(guildId, mode);
    },
  };
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
    const pendingConnections: ((connection: AssistantConnection) => void)[] =
      [];
    const h = managerHarness({
      joinAssistantChannel: () =>
        new Promise((resolve) => {
          pendingConnections.push(resolve);
        }),
    });
    const first = h.manager.join(GUILD, "channel-1");
    const second = h.manager.join(GUILD, "channel-2");
    // Only the first join has reached the connection step; the second is
    // queued behind it rather than racing past the "no session" check.
    expect(pendingConnections).toHaveLength(1);
    pendingConnections[0]?.(fakeConnection());
    await first;
    expect(pendingConnections).toHaveLength(2);
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
