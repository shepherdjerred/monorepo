import { afterEach, describe, expect, test, vi } from "vitest";
import type { ChatInputCommandInteraction } from "discord.js";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import type { CommandReply } from "#src/discord/commands/define-command.ts";
import { commandList, executeHelp } from "#src/discord/commands/help.ts";
import { resetConfigurationForTests } from "#src/configuration.ts";
import {
  addFlagOverride,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";

const originalAllowlist = Bun.env["EXPLORE_GUILD_ALLOWLIST"];
const originalEnvironment = Bun.env["ENVIRONMENT"];

afterEach(() => {
  if (originalAllowlist === undefined) {
    delete Bun.env["EXPLORE_GUILD_ALLOWLIST"];
  } else {
    Bun.env["EXPLORE_GUILD_ALLOWLIST"] = originalAllowlist;
  }
  if (originalEnvironment === undefined) {
    delete Bun.env["ENVIRONMENT"];
  } else {
    Bun.env["ENVIRONMENT"] = originalEnvironment;
  }
  resetConfigurationForTests();
  resetFlagOverrides("betting_enabled");
  resetFlagOverrides("voice_assistant_enabled");
});

describe("/help", () => {
  test("presents the retained commands and web-only management areas", async () => {
    const replyMock = vi.fn(
      (payload: Parameters<ChatInputCommandInteraction["reply"]>[0]) =>
        Promise.resolve(payload),
    );
    const reply: CommandReply = replyMock;

    await executeHelp({ guildId: null, reply });

    expect(replyMock).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true }),
    );
    const payload = replyMock.mock.calls[0]?.[0];
    expect(JSON.stringify(payload)).toContain("/track");
    expect(JSON.stringify(payload)).toContain("audit history");
    expect(JSON.stringify(payload)).not.toContain("/subscription");
    expect(JSON.stringify(payload)).not.toContain("/scout ask");
  });

  test("includes Scout Explore only inside an allowlisted guild", async () => {
    Bun.env["ENVIRONMENT"] = "beta";
    Bun.env["EXPLORE_GUILD_ALLOWLIST"] = "100000000000000001";
    resetConfigurationForTests();
    const replyMock = vi.fn(
      (payload: Parameters<ChatInputCommandInteraction["reply"]>[0]) =>
        Promise.resolve(payload),
    );
    const reply: CommandReply = replyMock;

    await executeHelp({ guildId: "100000000000000001", reply });
    expect(JSON.stringify(replyMock.mock.calls[0]?.[0])).toContain(
      "/scout ask",
    );
  });

  test("lists flag-gated commands only where their flag is on", async () => {
    Bun.env["ENVIRONMENT"] = "beta";
    resetConfigurationForTests();
    const gatedGuild = "100000000000000003";
    const otherGuild = "100000000000000004";
    const server = DiscordGuildIdSchema.parse(gatedGuild);
    addFlagOverride("betting_enabled", true, { server });
    addFlagOverride("voice_assistant_enabled", true, { server });

    const gated = await commandList(gatedGuild);
    expect(gated).toContain("`/bb`");
    // The voice flag alone is not enough: this deployment has no
    // VOICE_ASSISTANT_ENABLED audio pipeline, so /scout join would answer
    // "not switched on" and must not be advertised.
    expect(gated).not.toContain("`/scout join`");
    expect(gated).not.toContain("`/lobby`");

    const other = await commandList(otherGuild);
    expect(other).not.toContain("`/bb`");
    expect(other).not.toContain("`/scout join`");
    expect(other).not.toContain("`/lobby`");
  });

  test("advertises voice only when the deployment gate is also on", async () => {
    Bun.env["ENVIRONMENT"] = "beta";
    Bun.env["VOICE_ASSISTANT_ENABLED"] = "true";
    Bun.env["OPENAI_API_KEY"] = "test-openai-key";
    resetConfigurationForTests();
    const gatedGuild = "100000000000000005";
    const server = DiscordGuildIdSchema.parse(gatedGuild);
    addFlagOverride("voice_assistant_enabled", true, { server });

    try {
      const gated = await commandList(gatedGuild);
      expect(gated).toContain("`/scout join`");
    } finally {
      delete Bun.env["VOICE_ASSISTANT_ENABLED"];
      delete Bun.env["OPENAI_API_KEY"];
      resetConfigurationForTests();
    }
  });

  test("includes Scout Explore in every production guild", async () => {
    Bun.env["ENVIRONMENT"] = "prod";
    delete Bun.env["EXPLORE_GUILD_ALLOWLIST"];
    resetConfigurationForTests();
    const replyMock = vi.fn(
      (payload: Parameters<ChatInputCommandInteraction["reply"]>[0]) =>
        Promise.resolve(payload),
    );

    await executeHelp({ guildId: "100000000000000002", reply: replyMock });

    expect(JSON.stringify(replyMock.mock.calls[0]?.[0])).toContain(
      "/scout ask",
    );
  });
});
