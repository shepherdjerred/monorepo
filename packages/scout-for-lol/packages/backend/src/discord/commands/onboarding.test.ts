import { describe, expect, mock, test } from "bun:test";
import type { ChatInputCommandInteraction } from "discord.js";
import type { CommandReply } from "#src/discord/commands/define-command.ts";
import {
  executeDocs,
  executeInvite,
  executeSetup,
  executeStatus,
} from "#src/discord/commands/onboarding.ts";

function interaction() {
  const replyMock = mock(
    (payload: Parameters<ChatInputCommandInteraction["reply"]>[0]) =>
      Promise.resolve(payload),
  );
  const reply: CommandReply = replyMock;
  return {
    replyMock,
    interaction: {
      reply,
      client: { ws: { ping: 42 } },
      guild: { name: "Test Guild" },
    },
  };
}

describe("lightweight onboarding commands", () => {
  test("/setup directs users to the dashboard and keeps /track optional", async () => {
    const command = interaction();
    await executeSetup(command.interaction);

    expect(command.replyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ephemeral: true,
        content: expect.stringContaining("/track"),
      }),
    );
  });

  test("/status reports gateway and guild availability", async () => {
    const command = interaction();
    await executeStatus(command.interaction);

    expect(command.replyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("42 ms"),
      }),
    );
  });

  test("/invite returns the canonical installation link", async () => {
    const command = interaction();
    await executeInvite(command.interaction);

    expect(command.replyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("discord.com/api/oauth2/authorize"),
      }),
    );
  });

  test("/docs returns the configured stage documentation URL", async () => {
    const command = interaction();
    await executeDocs(command.interaction);

    expect(command.replyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("https://scout-for-lol.com/docs/"),
      }),
    );
  });
});
