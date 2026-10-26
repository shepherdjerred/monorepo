import { sendDM } from "#src/discord/utils/dm.ts";
import { readOutreachState } from "#src/discord/utils/outreach-state.ts";
import {
  DmMessageBodySchema,
  MOCK_DM_CHANNEL_ID,
  mockClient,
  mockDmClient,
  type DmMessageBody,
} from "#src/testing/discord-mocks.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testAccountId, testGuildId } from "#src/testing/test-ids.ts";
import {
  Client,
  DiscordAPIError,
  RESTJSONErrorCodes,
  Routes,
} from "discord.js";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";

const { prisma } = createTestDatabase("dm-audit-test");

const recipientId = testAccountId("555");
const guildId = testGuildId("777");
const installedAt = new Date("2026-01-01T00:00:00.000Z");

function clientWithSend(send: (body: DmMessageBody) => Promise<unknown>) {
  return mockDmClient({ send, tag: "Recipient#1234" });
}

function discordRejection(code: number, message: string): DiscordAPIError {
  return new DiscordAPIError(
    { code, message },
    code,
    403,
    "POST",
    `https://discord.com/api/v10/channels/${MOCK_DM_CHANNEL_ID}/messages`,
    { files: [], body: {} },
  );
}

/** An outreach rung, the budgeted path the daily schedule takes. */
const outreachBudget = {
  guildId,
  serverName: "Budget Server",
  installedAt,
  ladderStage: 1,
};

/**
 * A real discord.js client that never logged into the gateway, exactly as the
 * activity-worker role holds it: the bot token is on `client.rest` (that is
 * what `authorizeDiscordRest` does), and `client.user` is `null` because only a
 * gateway READY payload sets it. The network is replaced at `client.rest`.
 */
function gatewaylessClient(options: {
  openDm?: () => Promise<unknown>;
  send?: (body: DmMessageBody) => Promise<unknown>;
}) {
  const client = new Client({ intents: [] });
  const get = vi.spyOn(client.rest, "get").mockImplementation((route) => {
    if (route !== Routes.user(recipientId))
      throw new Error(`Unexpected Discord REST GET ${route}`);
    return Promise.resolve({
      id: recipientId,
      username: "recipient",
      discriminator: "0",
      global_name: null,
      avatar: null,
    });
  });
  const post = vi
    .spyOn(client.rest, "post")
    .mockImplementation(async (route, request) => {
      if (route === Routes.userChannels()) {
        return await (options.openDm?.() ??
          Promise.resolve({ id: MOCK_DM_CHANNEL_ID, type: 1 }));
      }
      if (route === Routes.channelMessages(MOCK_DM_CHANNEL_ID)) {
        const body = DmMessageBodySchema.parse(request?.body);
        return await (options.send?.(body) ??
          Promise.resolve({ id: "1", channel_id: MOCK_DM_CHANNEL_ID }));
      }
      throw new Error(`Unexpected Discord REST POST ${route}`);
    });
  return { client, get, post };
}

beforeEach(async () => {
  await prisma.dmAuditLog.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("sendDM", () => {
  test("records a 'sent' audit row when delivery succeeds", async () => {
    const client = clientWithSend(() => Promise.resolve({}));

    const status = await sendDM({
      client,
      userId: recipientId,
      message: "hello there",
      // A core kind: non-core kinds now require a budget at this chokepoint,
      // so that they cannot slip past the lifetime cap or the footer.
      kind: "prune_notice",
      guildId,
      prisma,
    });

    expect(status).toBe("sent");

    const rows = await prisma.dmAuditLog.findMany();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.deliveryStatus).toBe("sent");
    expect(row?.kind).toBe("prune_notice");
    expect(row?.recipientId).toBe(recipientId);
    expect(row?.recipientTag).toBe("Recipient#1234");
    expect(row?.guildId).toBe(guildId);
    expect(row?.content).toBe("hello there");
    expect(row?.errorMessage).toBeNull();
  });

  test("can render informational mentions without notifying recipients", async () => {
    const send = vi.fn((_body: DmMessageBody) => Promise.resolve({}));
    const client = clientWithSend(send);

    const status = await sendDM({
      client,
      userId: recipientId,
      message: "<@123456789012345678> accepted a Dare",
      kind: "dare_notification",
      guildId,
      prisma,
      suppressMentions: true,
    });

    expect(status).toBe("sent");
    expect(send).toHaveBeenCalledWith({
      content: "<@123456789012345678> accepted a Dare",
      allowed_mentions: { parse: [] },
    });
  });

  test("records a 'dm_disabled' audit row when the user blocks DMs (50007)", async () => {
    const client = clientWithSend(() =>
      Promise.reject(
        discordRejection(
          RESTJSONErrorCodes.CannotSendMessagesToThisUser,
          "Cannot send messages to this user",
        ),
      ),
    );

    const status = await sendDM({
      client,
      userId: recipientId,
      message: "prune notice",
      kind: "prune_notice",
      prisma,
    });

    expect(status).toBe("dm_disabled");

    const rows = await prisma.dmAuditLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deliveryStatus).toBe("dm_disabled");
    expect(rows[0]?.kind).toBe("prune_notice");
    expect(rows[0]?.errorMessage).toContain(
      "Cannot send messages to this user",
    );
  });

  test("records a 'failed' audit row for any other error", async () => {
    const client = clientWithSend(() =>
      Promise.reject(new Error("network exploded")),
    );
    const onSendAttempt = vi.fn();

    const status = await sendDM({
      client,
      userId: recipientId,
      message: "permission issue",
      kind: "permission_error",
      guildId,
      prisma,
      onSendAttempt,
    });

    expect(status).toBe("failed");
    expect(onSendAttempt).toHaveBeenCalledOnce();

    const rows = await prisma.dmAuditLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deliveryStatus).toBe("failed");
    expect(rows[0]?.errorMessage).toContain("network exploded");
  });

  test("does not mark a recipient lookup failure as a send attempt", async () => {
    const client = mockClient({
      users: {
        cache: new Map(),
        fetch: () => Promise.reject(new Error("recipient lookup unavailable")),
      },
    });
    const onSendAttempt = vi.fn();

    const status = await sendDM({
      client,
      userId: recipientId,
      message: "Dare progressed",
      kind: "dare_notification",
      guildId,
      prisma,
      onSendAttempt,
    });

    expect(status).toBe("failed");
    expect(onSendAttempt).not.toHaveBeenCalled();
  });
});

describe("sendDM on a role with no gateway login", () => {
  test("delivers through the bot REST client although client.user is null", async () => {
    const { client, post } = gatewaylessClient({});
    expect(client.user).toBeNull();

    const status = await sendDM({
      client,
      userId: recipientId,
      message: "prune notice",
      kind: "prune_notice",
      guildId,
      prisma,
    });

    expect(status).toBe("sent");
    expect(post.mock.calls.map(([route]) => route)).toEqual([
      Routes.userChannels(),
      Routes.channelMessages(MOCK_DM_CHANNEL_ID),
    ]);
    expect(post.mock.calls[0]?.[1]).toEqual({
      body: { recipient_id: recipientId },
    });
    const row = await prisma.dmAuditLog.findFirstOrThrow();
    expect(row.deliveryStatus).toBe("sent");
    expect(row.recipientTag).toBe("recipient");
    expect(row.errorMessage).toBeNull();
    await client.destroy();
  });

  test("settles an outreach reservation as sent instead of charging an unknown", async () => {
    const send = vi.fn((_body: DmMessageBody) =>
      Promise.resolve({ id: "1", channel_id: MOCK_DM_CHANNEL_ID }),
    );
    const { client } = gatewaylessClient({ send });

    const status = await sendDM({
      client,
      userId: recipientId,
      message: "Add your first player",
      kind: "outreach_nudge",
      guildId,
      prisma,
      budget: outreachBudget,
    });

    expect(status).toBe("sent");
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0].content).toContain("Add your first player");
    const row = await prisma.dmAuditLog.findFirstOrThrow();
    expect(row.deliveryStatus).toBe("sent");
    expect(row.ladderStage).toBe(1);
    await client.destroy();
  });

  test("releases the rung when the DM channel cannot be opened, because no message left", async () => {
    const send = vi.fn((_body: DmMessageBody) => Promise.resolve({}));
    const { client } = gatewaylessClient({
      openDm: () => Promise.reject(new Error("socket hang up")),
      send,
    });
    const onSendAttempt = vi.fn();

    const status = await sendDM({
      client,
      userId: recipientId,
      message: "Add your first player",
      kind: "outreach_nudge",
      guildId,
      prisma,
      budget: outreachBudget,
      onSendAttempt,
    });

    expect(status).toBe("failed");
    expect(onSendAttempt).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    const row = await prisma.dmAuditLog.findFirstOrThrow();
    expect(row.deliveryStatus).toBe("failed");
    expect(row.errorMessage).toContain("socket hang up");
    // The ladder and its budget see nothing charged, so tomorrow retries.
    expect(await readOutreachState(prisma, guildId, installedAt)).toEqual({
      spent: 0,
      lastLadderStage: 0,
      feedbackRequested: false,
    });
    await client.destroy();
  });

  test("treats Discord's no-mutual-guild refusal (50278) as undeliverable, not uncertain", async () => {
    const { client } = gatewaylessClient({
      send: () =>
        Promise.reject(
          discordRejection(
            RESTJSONErrorCodes.CannotSendMessagesToThisUserDueToHavingNoMutualGuilds,
            "Cannot send messages to this user due to having no mutual guilds",
          ),
        ),
    });

    const status = await sendDM({
      client,
      userId: recipientId,
      message: "How's it going?",
      kind: "feedback_request",
      guildId,
      prisma,
      budget: { ...outreachBudget, ladderStage: 2 },
    });

    expect(status).toBe("dm_disabled");
    const row = await prisma.dmAuditLog.findFirstOrThrow();
    expect(row.deliveryStatus).toBe("dm_disabled");
    const state = await readOutreachState(prisma, guildId, installedAt);
    expect(state.spent).toBe(0);
    await client.destroy();
  });
});
