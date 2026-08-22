import { afterEach, describe, expect, test, vi } from "vitest";
import type { ChatInputCommandInteraction } from "discord.js";
import type { CommandReply } from "#src/discord/commands/define-command.ts";
import { executeHelp } from "#src/discord/commands/help.ts";
import { resetConfigurationForTests } from "#src/configuration.ts";

const originalAllowlist = Bun.env["EXPLORE_GUILD_ALLOWLIST"];

afterEach(() => {
  if (originalAllowlist === undefined) {
    delete Bun.env["EXPLORE_GUILD_ALLOWLIST"];
  } else {
    Bun.env["EXPLORE_GUILD_ALLOWLIST"] = originalAllowlist;
  }
  resetConfigurationForTests();
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
});
