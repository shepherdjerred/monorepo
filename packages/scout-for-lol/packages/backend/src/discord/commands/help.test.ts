import { describe, expect, mock, test } from "bun:test";
import type { ChatInputCommandInteraction } from "discord.js";
import type { CommandReply } from "#src/discord/commands/define-command.ts";
import { executeHelp } from "#src/discord/commands/help.ts";

describe("/help", () => {
  test("presents the retained commands and web-only management areas", async () => {
    const replyMock = mock(
      (payload: Parameters<ChatInputCommandInteraction["reply"]>[0]) =>
        Promise.resolve(payload),
    );
    const reply: CommandReply = replyMock;

    await executeHelp({ reply });

    expect(replyMock).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true }),
    );
    const payload = replyMock.mock.calls[0]?.[0];
    expect(JSON.stringify(payload)).toContain("/track");
    expect(JSON.stringify(payload)).toContain("audit history");
    expect(JSON.stringify(payload)).not.toContain("/subscription");
  });
});
