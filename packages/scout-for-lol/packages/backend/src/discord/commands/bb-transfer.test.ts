import { describe, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { bbCommand } from "#src/discord/commands/bb-definition.ts";
import { isPublicBbSubcommand } from "#src/discord/commands/bb.ts";
import type { BbCommandInteraction } from "#src/discord/commands/bb-interaction.ts";
import {
  buildTransferReceipt,
  replyBbTransfer,
} from "#src/discord/commands/bb-transfer.ts";

const SERVER = DiscordGuildIdSchema.parse("1337623164146155593");
const SENDER = DiscordAccountIdSchema.parse("160509172704739328");
const RECIPIENT = DiscordAccountIdSchema.parse("160509172704739329");

function fakeInteraction(input?: {
  recipientBot?: boolean;
  followUpRejects?: boolean;
}): BbCommandInteraction {
  return {
    id: "bb-transfer-test",
    guildId: SERVER,
    user: { id: SENDER },
    options: {
      getSubcommand: () => "transfer",
      getString: () => "",
      getInteger: () => 3,
      getUser: () => ({ id: RECIPIENT, bot: input?.recipientBot ?? false }),
    },
    replied: false,
    deferred: true,
    reply: vi.fn(() => Promise.resolve(undefined)),
    deferReply: vi.fn(() => Promise.resolve(undefined)),
    editReply: vi.fn(() => Promise.resolve(undefined)),
    followUp: vi.fn(() =>
      input?.followUpRejects === true
        ? Promise.reject(new Error("Discord unavailable"))
        : Promise.resolve(undefined),
    ),
  };
}

describe("/bb transfer", () => {
  test("registers required recipient and bounded whole-BB amount options", () => {
    const transfer = bbCommand
      .toJSON()
      .options?.find((option) => option.name === "transfer");
    if (transfer === undefined || !("options" in transfer)) {
      throw new Error("/bb transfer should be a subcommand with options");
    }
    expect(transfer.options).toEqual([
      expect.objectContaining({ name: "recipient", required: true, type: 6 }),
      expect.objectContaining({
        name: "amount",
        required: true,
        type: 4,
        min_value: 2,
        max_value: 2_147_483_647,
      }),
    ]);
    expect(isPublicBbSubcommand("transfer")).toBe(false);
  });

  test("posts the exact public receipt with only both users mentionable", async () => {
    const interaction = fakeInteraction();
    const runTransfer = vi.fn(() =>
      Promise.resolve({
        kind: "transferred" as const,
        transferId: "df505f9c-0f98-45e5-9e32-cf5e2b6eb2e0",
        totalAmount: 3,
        recipientAmount: 1,
        feeAmount: 2,
        balanceAfter: 97,
      }),
    );
    await replyBbTransfer(interaction, SERVER, SENDER, { runTransfer });

    expect(runTransfer).toHaveBeenCalledWith({
      serverId: SERVER,
      senderDiscordId: SENDER,
      recipientDiscordId: RECIPIENT,
      recipientIsBot: false,
      amount: 3,
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content:
        "Transfer complete. 1 BB went to <@160509172704739329> and 2 BB went to the house.",
      allowedMentions: { parse: [] },
    });
    expect(interaction.followUp).toHaveBeenCalledWith({
      content:
        "💸 **Bryan Bucks Western Union**\n<@160509172704739328> spent **3 BB** to send <@160509172704739329> **1 BB**. The house collected **2 BB**.",
      allowedMentions: {
        parse: [],
        users: [SENDER, RECIPIENT],
        repliedUser: false,
      },
    });
    expect(
      JSON.stringify(vi.mocked(interaction.followUp).mock.calls),
    ).not.toContain("97");
  });

  test("keeps validation failures private and sends no receipt", async () => {
    const interaction = fakeInteraction({ recipientBot: true });
    await replyBbTransfer(interaction, SERVER, SENDER, {
      runTransfer: () => Promise.resolve({ kind: "recipient_bot" }),
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: "Bots cannot receive Bryan Bucks transfers.",
    });
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  test("reports post-commit receipt failure without rerunning the transfer", async () => {
    const interaction = fakeInteraction({ followUpRejects: true });
    const runTransfer = vi.fn(() =>
      Promise.resolve({
        kind: "transferred" as const,
        transferId: "df505f9c-0f98-45e5-9e32-cf5e2b6eb2e0",
        totalAmount: 3,
        recipientAmount: 1,
        feeAmount: 2,
        balanceAfter: 97,
      }),
    );
    await expect(
      replyBbTransfer(interaction, SERVER, SENDER, { runTransfer }),
    ).resolves.toBeUndefined();
    expect(runTransfer).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenLastCalledWith({
      content:
        "Transfer complete, but I could not post the public receipt. The transfer was not reversed; please do not retry it.",
    });
  });

  test("formats an even transfer without exposing balances", () => {
    const receipt = buildTransferReceipt({
      senderDiscordId: SENDER,
      recipientDiscordId: RECIPIENT,
      totalAmount: 10,
      recipientAmount: 5,
      feeAmount: 5,
    });
    expect(receipt).toContain("spent **10 BB**");
    expect(receipt).toContain("**5 BB**");
    expect(receipt).not.toContain("balance");
  });
});
