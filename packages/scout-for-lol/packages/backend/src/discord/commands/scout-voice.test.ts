import { describe, expect, test } from "vitest";
import type {
  InteractionEditReplyOptions,
  InteractionReplyOptions,
} from "discord.js";
import { executeScoutVoice } from "#src/discord/commands/scout-voice.ts";

const GUILD = "100000000000000001";

type HarnessOptions = {
  flagEnabled?: boolean;
  runtimeAvailable?: boolean;
  memberChannelId?: string | null;
  activeChannelId?: string | undefined;
  leaveResult?: boolean;
};

function voiceHarness(options: HarnessOptions = {}) {
  const replies: string[] = [];
  /** Interaction lifecycle events, in order: reply / defer / edit / join. */
  const events: string[] = [];
  const joins: { guildId: string; channelId: string }[] = [];
  const leaves: string[] = [];
  const interaction = {
    guildId: GUILD,
    user: { id: "user-1" },
    reply: (payload: InteractionReplyOptions) => {
      events.push("reply");
      if (typeof payload.content === "string") replies.push(payload.content);
      return Promise.resolve();
    },
    deferReply: () => {
      events.push("defer");
      return Promise.resolve();
    },
    editReply: (payload: InteractionEditReplyOptions) => {
      events.push("edit");
      if (typeof payload.content === "string") replies.push(payload.content);
      return Promise.resolve();
    },
  };
  const dependencies = {
    isVoiceEnabledForGuild: () => Promise.resolve(options.flagEnabled ?? true),
    isRuntimeAvailable: () => options.runtimeAvailable ?? true,
    manager: () => ({
      join: (guildId: string, channelId: string) => {
        events.push("join");
        joins.push({ guildId, channelId });
        return Promise.resolve();
      },
      leave: (guildId: string) => {
        leaves.push(guildId);
        return options.leaveResult ?? true;
      },
      isActive: () => options.activeChannelId !== undefined,
      activeChannelId: () => options.activeChannelId,
    }),
    memberVoiceChannelId: () => options.memberChannelId ?? null,
  };
  return { interaction, dependencies, replies, events, joins, leaves };
}

describe("/scout join and /scout leave", () => {
  test("refuses DMs", async () => {
    const h = voiceHarness();
    await executeScoutVoice(
      { ...h.interaction, guildId: null },
      "join",
      h.dependencies,
    );
    expect(h.replies[0]).toContain("inside a server");
    expect(h.joins).toEqual([]);
  });

  test("answers plainly when the guild flag is off", async () => {
    const h = voiceHarness({ flagEnabled: false });
    await executeScoutVoice(h.interaction, "join", h.dependencies);
    expect(h.replies[0]).toContain("not enabled in this server");
    expect(h.joins).toEqual([]);
  });

  test("answers plainly when the deployment has no voice runtime", async () => {
    const h = voiceHarness({ runtimeAvailable: false });
    await executeScoutVoice(h.interaction, "join", h.dependencies);
    expect(h.replies[0]).toContain("not switched on in this deployment");
    expect(h.joins).toEqual([]);
  });

  test("join requires the requester to be in a voice channel", async () => {
    const h = voiceHarness({ memberChannelId: null });
    await executeScoutVoice(h.interaction, "join", h.dependencies);
    expect(h.replies[0]).toContain("Join a voice channel first");
    expect(h.joins).toEqual([]);
  });

  test("join starts a session in the requester's channel", async () => {
    const h = voiceHarness({ memberChannelId: "vc-1" });
    await executeScoutVoice(h.interaction, "join", h.dependencies);
    expect(h.joins).toEqual([{ guildId: GUILD, channelId: "vc-1" }]);
    expect(h.replies[0]).toContain("Hey Scout");
    // The interaction is acknowledged BEFORE the voice join, which can wait
    // up to 30 s for Ready — past Discord's acknowledgement window.
    expect(h.events).toEqual(["defer", "join", "edit"]);
  });

  test("join in the already-active channel does not restart the session", async () => {
    const h = voiceHarness({
      memberChannelId: "vc-1",
      activeChannelId: "vc-1",
    });
    await executeScoutVoice(h.interaction, "join", h.dependencies);
    expect(h.joins).toEqual([]);
    expect(h.replies[0]).toContain("already listening");
  });

  test("join from another channel moves the session", async () => {
    const h = voiceHarness({
      memberChannelId: "vc-2",
      activeChannelId: "vc-1",
    });
    await executeScoutVoice(h.interaction, "join", h.dependencies);
    expect(h.joins).toEqual([{ guildId: GUILD, channelId: "vc-2" }]);
  });

  test("leave tears the session down", async () => {
    const h = voiceHarness({ activeChannelId: "vc-1" });
    await executeScoutVoice(h.interaction, "leave", h.dependencies);
    expect(h.leaves).toEqual([GUILD]);
    expect(h.replies[0]).toContain("left the voice channel");
  });

  test("leave without a session says so", async () => {
    const h = voiceHarness({ leaveResult: false });
    await executeScoutVoice(h.interaction, "leave", h.dependencies);
    expect(h.replies[0]).toContain("not in a voice channel");
  });

  test("leave still works after the guild flag is switched off", async () => {
    // Consent control: an operator flipping the flag off (or a client with a
    // cached command) must never strand an active session un-stoppable.
    const h = voiceHarness({ flagEnabled: false, activeChannelId: "vc-1" });
    await executeScoutVoice(h.interaction, "leave", h.dependencies);
    expect(h.leaves).toEqual([GUILD]);
    expect(h.replies[0]).toContain("left the voice channel");
  });

  test("leave still works when the runtime is unavailable", async () => {
    const h = voiceHarness({ runtimeAvailable: false, leaveResult: false });
    await executeScoutVoice(h.interaction, "leave", h.dependencies);
    expect(h.leaves).toEqual([GUILD]);
    expect(h.replies[0]).toContain("not in a voice channel");
  });
});
