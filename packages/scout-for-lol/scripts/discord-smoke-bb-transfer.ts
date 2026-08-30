import path from "node:path";
import {
  BucksLedgerContextSchema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { DirectSlashResponseSchema } from "@shepherdjerred/toolkit/lib/discord/ipc.ts";
import { ensureBucksAccount } from "@scout-for-lol/backend/betting/accounts.ts";
import { HOUSE_ACCOUNT_DISCORD_ID } from "@scout-for-lol/backend/betting/constants.ts";
import type { connectTestDatabase } from "@scout-for-lol/backend/testing/test-database.ts";
import { z } from "zod";
import { captureDiscordMessage } from "./discord-smoke-browser.ts";
import type {
  DiscordSmokeFixture,
  DiscordSmokeManifest,
  DiscordSmokePreflightDependencies,
} from "./discord-smoke-core.ts";
import { readPipedProcess } from "./discord-smoke-process.ts";

const TRANSFER_AMOUNT = 3;
type SmokeDatabase = ReturnType<typeof connectTestDatabase>;
export type SeededAccounts = NonNullable<
  DiscordSmokeManifest["seededAccounts"]
>;

const DiscordReceiptMessageSchema = z.object({
  id: z.string().regex(/^\d{17,20}$/u),
  content: z.string(),
  author: z.object({ id: z.string() }),
  timestamp: z.string().refine((value) => Number.isFinite(Date.parse(value))),
});

export async function seedTransferAccounts(
  database: SmokeDatabase,
  fixture: DiscordSmokeFixture,
): Promise<SeededAccounts> {
  const serverId = DiscordGuildIdSchema.parse(fixture.guildId);
  const sender = await ensureBucksAccount(
    {
      serverId,
      discordId: DiscordAccountIdSchema.parse(fixture.invokingUserId),
    },
    database,
  );
  const recipient = await ensureBucksAccount(
    {
      serverId,
      discordId: DiscordAccountIdSchema.parse(fixture.recipientUserId),
    },
    database,
  );
  const house = await database.bucksAccount.findUniqueOrThrow({
    where: {
      serverId_discordId: {
        serverId,
        discordId: HOUSE_ACCOUNT_DISCORD_ID,
      },
    },
    select: { id: true, balance: true },
  });
  return {
    senderId: sender.id,
    senderBalance: sender.balance,
    recipientId: recipient.id,
    recipientBalance: recipient.balance,
    houseId: house.id,
    houseBalance: house.balance,
  };
}

export function expectedPrivateReply(fixture: DiscordSmokeFixture): string {
  return `Transfer complete. 1 BB went to <@${fixture.recipientUserId}> and 2 BB went to the house.`;
}

export function expectedPublicReceipt(fixture: DiscordSmokeFixture): string {
  return (
    "💸 **Bryan Bucks Western Union**\n" +
    `<@${fixture.invokingUserId}> spent **3 BB** to send ` +
    `<@${fixture.recipientUserId}> **1 BB**. The house collected **2 BB**.`
  );
}

export async function invokeTransfer(
  fixture: DiscordSmokeFixture,
  toolkitEntrypoint: string,
  workspaceRoot: string,
) {
  const child = Bun.spawn(
    [
      "bun",
      toolkitEntrypoint,
      "discord",
      "slash",
      fixture.channelId,
      fixture.applicationId,
      "bb",
      "transfer",
      `recipient:${fixture.recipientUserId}`,
      `amount:${TRANSFER_AMOUNT.toString()}`,
      "--direct",
      "--wait-public",
      "--contains",
      "Bryan Bucks Western Union",
      "--timeout",
      "60",
      "--json",
    ],
    { cwd: workspaceRoot, stdout: "pipe", stderr: "pipe", env: Bun.env },
  );
  const stdout = await readPipedProcess(
    child,
    "Direct Discord invocation failed",
  );
  const parsed: unknown = JSON.parse(stdout);
  return DirectSlashResponseSchema.parse(parsed);
}

function assertPrivateReply(
  fixture: DiscordSmokeFixture,
  response: ReturnType<typeof DirectSlashResponseSchema.parse>,
): void {
  if (response.invokingUserId !== fixture.invokingUserId) {
    throw new Error(
      `Slash invocation used Discord user ${response.invokingUserId}, expected ${fixture.invokingUserId}`,
    );
  }
  if (response.reply === null) {
    throw new Error("Western Union smoke did not receive a private reply");
  }
  if (response.reply.content !== expectedPrivateReply(fixture)) {
    throw new Error(
      `Western Union private reply changed: ${response.reply.content}`,
    );
  }
}

function assertPublicReceipt(
  fixture: DiscordSmokeFixture,
  response: ReturnType<typeof DirectSlashResponseSchema.parse>,
): void {
  const receipt = response.publicResponse;
  if (receipt === null) {
    if (response.publicResponseTimedOut) return;
    throw new Error("Western Union smoke returned no public receipt state");
  }
  if (
    receipt.authorId !== fixture.applicationId ||
    receipt.content !== expectedPublicReceipt(fixture)
  ) {
    throw new Error("Western Union public receipt identity or copy changed");
  }
  const userMentions = [...receipt.mentionUserIds].sort();
  const expectedMentions = [
    fixture.invokingUserId,
    fixture.recipientUserId,
  ].sort();
  if (
    userMentions.join(",") !== expectedMentions.join(",") ||
    receipt.mentionRoleIds.length > 0 ||
    receipt.mentionsEveryone
  ) {
    throw new Error(
      "Western Union receipt must mention only the sender and recipient",
    );
  }
}

export function assertTransferResponse(
  fixture: DiscordSmokeFixture,
  response: ReturnType<typeof DirectSlashResponseSchema.parse>,
): void {
  assertPrivateReply(fixture, response);
  assertPublicReceipt(fixture, response);
}

function validateTransferContexts(
  entries: readonly { context: string }[],
  seeded: SeededAccounts,
): void {
  const contexts = entries.map((entry) =>
    BucksLedgerContextSchema.parse(JSON.parse(entry.context)),
  );
  if (contexts.some((context) => context.type !== "transfer")) {
    throw new Error("Transfer ledger row used a non-transfer context");
  }
  const transferIds = new Set(
    contexts.flatMap((context) =>
      context.type === "transfer" ? [context.transferId] : [],
    ),
  );
  const roles = contexts.flatMap((context) =>
    context.type === "transfer" ? [context.role] : [],
  );
  if (transferIds.size !== 1 || roles.join(",") !== "sender,recipient,house") {
    throw new Error("Transfer ledger correlation or row roles changed");
  }
  for (const context of contexts) {
    if (
      context.type === "transfer" &&
      (context.senderAccountId !== seeded.senderId ||
        context.recipientAccountId !== seeded.recipientId ||
        context.houseAccountId !== seeded.houseId ||
        context.totalAmount !== 3 ||
        context.recipientAmount !== 1 ||
        context.feeAmount !== 2)
    ) {
      throw new Error("Transfer ledger context does not match the smoke run");
    }
  }
}

export async function verifyTransferDatabase(
  database: SmokeDatabase,
  fixture: DiscordSmokeFixture,
  seeded: SeededAccounts,
): Promise<void> {
  const entries = await database.bucksLedgerEntry.findMany({
    where: { kind: { startsWith: "transfer_" } },
    orderBy: { id: "asc" },
  });
  if (entries.length !== 3) {
    throw new Error(
      `Expected three transfer ledger rows, found ${entries.length.toString()}`,
    );
  }
  const movements = entries.map((entry) => [entry.kind, entry.delta].join(":"));
  if (
    movements.join(",") !==
    "transfer_sent:-3,transfer_received:1,transfer_fee:2"
  ) {
    throw new Error(`Unexpected transfer movements: ${movements.join(",")}`);
  }
  validateTransferContexts(entries, seeded);

  const accounts = await database.bucksAccount.findMany({
    where: {
      id: { in: [seeded.senderId, seeded.recipientId, seeded.houseId] },
      serverId: DiscordGuildIdSchema.parse(fixture.guildId),
    },
    orderBy: { id: "asc" },
    select: { id: true, balance: true },
  });
  const balanceById = new Map(
    accounts.map((account) => [account.id, account.balance]),
  );
  if (
    balanceById.get(seeded.senderId) !== seeded.senderBalance - 3 ||
    balanceById.get(seeded.recipientId) !== seeded.recipientBalance + 1 ||
    balanceById.get(seeded.houseId) !== seeded.houseBalance + 2
  ) {
    throw new Error("Stored Bryan Bucks balances do not match the 3/1/2 split");
  }
  const balanceBefore =
    seeded.senderBalance + seeded.recipientBalance + seeded.houseBalance;
  const balanceAfter = accounts.reduce(
    (total, account) => total + account.balance,
    0,
  );
  if (balanceAfter !== balanceBefore) {
    throw new Error("Western Union smoke did not conserve Bryan Bucks");
  }
  const outboxCount = await database.bucksAnalyticsLedgerOutbox.count({
    where: { ledgerEntryId: { in: entries.map((entry) => entry.id) } },
  });
  if (outboxCount !== 3) {
    throw new Error(
      `Expected three analytics outbox rows, found ${outboxCount.toString()}`,
    );
  }
}

export async function findReceiptMessageId(
  fixture: DiscordSmokeFixture,
  botToken: string,
  invocationStartedAt: string,
  fetcher: DiscordSmokePreflightDependencies["fetch"] = fetch,
): Promise<string> {
  const response = await fetcher(
    `https://discord.com/api/v10/channels/${fixture.channelId}/messages?limit=100`,
    { headers: { authorization: `Bot ${botToken}` } },
  );
  if (!response.ok) {
    throw new Error(
      `Discord receipt lookup returned HTTP ${response.status.toString()}`,
    );
  }
  const messages = z
    .array(DiscordReceiptMessageSchema)
    .parse(await response.json());
  const invocationStartedAtMilliseconds = Date.parse(invocationStartedAt);
  if (!Number.isFinite(invocationStartedAtMilliseconds)) {
    throw new TypeError(
      `Invalid smoke invocation timestamp: ${invocationStartedAt}`,
    );
  }
  const receipt = messages.find(
    (message) =>
      message.author.id === fixture.applicationId &&
      message.content === expectedPublicReceipt(fixture) &&
      Date.parse(message.timestamp) >= invocationStartedAtMilliseconds,
  );
  if (receipt === undefined) {
    throw new Error(
      "Committed transfer exists but its public receipt was not found",
    );
  }
  return receipt.id;
}

export async function captureReceipt(
  fixture: DiscordSmokeFixture,
  publicMessageId: string,
  runDirectory: string,
): Promise<string> {
  const screenshotPath = path.join(runDirectory, "bb-transfer.png");
  await captureDiscordMessage({
    profileName: fixture.pinchTabProfile,
    guildId: fixture.guildId,
    channelId: fixture.channelId,
    messageId: publicMessageId,
    expectedVisibleFragments: [
      "Bryan Bucks Western Union",
      "spent 3 BB",
      "1 BB",
      "The house collected 2 BB",
    ],
    outputPath: screenshotPath,
  });
  return screenshotPath;
}
