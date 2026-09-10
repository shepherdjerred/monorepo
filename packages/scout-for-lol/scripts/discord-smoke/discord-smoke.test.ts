import { DirectSlashResponseSchema } from "@shepherdjerred/toolkit/lib/discord/ipc.ts";
import { describe, expect, test } from "vitest";
import {
  assertTransferResponse,
  expectedPrivateReply,
  expectedPublicReceipt,
  findReceiptMessageId,
} from "./discord-smoke-bb-transfer.ts";
import { DiscordSmokeFixtureSchema } from "./discord-smoke-core.ts";
import { parseDiscordSmokeArguments } from "./discord-smoke.ts";

const fixture = DiscordSmokeFixtureSchema.parse({
  applicationId: "1542993271477899294",
  botUserId: "1542993271477899294",
  invokingUserId: "1515150733660520496",
  recipientUserId: "160509172704739328",
  guildId: "100000000000000001",
  channelId: "100000000000000002",
  pinchTabProfile: "scout-discord-smoke",
});

function message(input: {
  readonly id: string;
  readonly content: string;
  readonly mentionUserIds?: string[] | undefined;
}) {
  return {
    id: input.id,
    channelId: fixture.channelId,
    authorId: fixture.applicationId,
    authorTag: "Derrej",
    authorIsBot: true,
    content: input.content,
    createdAt: "2026-08-29T00:00:00.000Z",
    embeds: [],
    attachments: [],
    mentionUserIds: input.mentionUserIds ?? [],
    mentionRoleIds: [],
    mentionsEveryone: false,
  };
}

describe("Discord smoke arguments", () => {
  test("accepts fresh gateway and transfer runs", () => {
    expect(parseDiscordSmokeArguments(["--scenario", "gateway"])).toEqual({
      kind: "fresh",
      scenario: "gateway",
    });
    expect(parseDiscordSmokeArguments(["--scenario", "bb-transfer"])).toEqual({
      kind: "fresh",
      scenario: "bb-transfer",
    });
  });

  test("accepts resume without selecting a scenario", () => {
    expect(parseDiscordSmokeArguments(["--resume", "run-1"])).toEqual({
      kind: "resume",
      runId: "run-1",
    });
    expect(() => parseDiscordSmokeArguments(["--scenario", "other"])).toThrow(
      "Unknown Discord smoke scenario",
    );
  });
});

describe("Western Union receipt contract", () => {
  test("accepts exact private and public copy with two user mentions", () => {
    const response = DirectSlashResponseSchema.parse({
      invoked: true,
      invokingUserId: fixture.invokingUserId,
      reply: message({
        id: "100000000000000011",
        content: expectedPrivateReply(fixture),
      }),
      publicResponse: message({
        id: "100000000000000012",
        content: expectedPublicReceipt(fixture),
        mentionUserIds: [fixture.invokingUserId, fixture.recipientUserId],
      }),
      publicResponseTimedOut: false,
    });

    expect(() => assertTransferResponse(fixture, response)).not.toThrow();
  });

  test("ignores an identical receipt from before this invocation", async () => {
    const fetcher = () =>
      Promise.resolve(
        Response.json([
          {
            id: "100000000000000011",
            content: expectedPublicReceipt(fixture),
            author: { id: fixture.applicationId },
            timestamp: "2026-08-29T00:00:00.000Z",
          },
          {
            id: "100000000000000012",
            content: expectedPublicReceipt(fixture),
            author: { id: fixture.applicationId },
            timestamp: "2026-08-29T00:02:00.000Z",
          },
        ]),
      );

    await expect(
      findReceiptMessageId(fixture, "bot", "2026-08-29T00:01:00.000Z", fetcher),
    ).resolves.toBe("100000000000000012");
  });

  test("rejects changed copy and broadened mentions", () => {
    const changedCopy = DirectSlashResponseSchema.parse({
      invoked: true,
      invokingUserId: fixture.invokingUserId,
      reply: message({
        id: "100000000000000011",
        content: "Transfer complete.",
      }),
      publicResponse: null,
      publicResponseTimedOut: true,
    });
    expect(() => assertTransferResponse(fixture, changedCopy)).toThrow(
      "private reply changed",
    );

    const broadenedMentions = DirectSlashResponseSchema.parse({
      invoked: true,
      invokingUserId: fixture.invokingUserId,
      reply: message({
        id: "100000000000000011",
        content: expectedPrivateReply(fixture),
      }),
      publicResponse: {
        ...message({
          id: "100000000000000012",
          content: expectedPublicReceipt(fixture),
          mentionUserIds: [fixture.invokingUserId, fixture.recipientUserId],
        }),
        mentionRoleIds: ["100000000000000013"],
      },
      publicResponseTimedOut: false,
    });
    expect(() => assertTransferResponse(fixture, broadenedMentions)).toThrow(
      "mention only",
    );
  });
});
