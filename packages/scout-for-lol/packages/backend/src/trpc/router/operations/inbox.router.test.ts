import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { DiscordAPIError } from "discord.js";
import {
  addFlagOverride,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import {
  SCOUT_OPERATOR_IDS,
  SCOUT_OPERATIONS_GUILD,
} from "#src/operations/operator-allowlist.ts";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import { dropTestDatabase } from "#src/testing/test-database.ts";
import { testAccountId } from "#src/testing/test-ids.ts";

const delivery = vi.fn(() => Promise.resolve());
vi.doMock("#src/lib/discord/support-reply.ts", () => ({
  deliverSupportReply: delivery,
}));
const trpc = await createOfflineTrpcHarness("support-inbox-router");
const db = trpc.prisma;
const { acceptSupportMessage } = await import("#src/support/conversations.ts");
const { runSupportJob, drainSupportJobs } =
  await import("#src/support/jobs.ts");
const [OPERATOR] = SCOUT_OPERATOR_IDS;
if (OPERATOR === undefined)
  throw new Error("Scout operator allowlist is empty");
const USER = testAccountId("991004");
const OTHER = testAccountId("991005");
const operator = trpc.authedCaller(OPERATOR);
const user = trpc.authedCaller(USER);

beforeAll(async () => {
  await initFeatureFlags({ environment: { FEATURE_FLAGS_MODE: "disabled" } });
});
beforeEach(async () => {
  await db.supportJob.deleteMany();
  await db.supportConversation.deleteMany();
  await db.feedback.deleteMany();
  await db.feedbackPromptState.deleteMany();
  await db.dmAuditLog.deleteMany();
  await db.supportTouchpoint.deleteMany();
  resetFlagOverrides("scout_operations_console_enabled");
  resetFlagOverrides("scout_support_conversations_enabled");
  addFlagOverride("scout_operations_console_enabled", true, {
    user: OPERATOR,
    server: SCOUT_OPERATIONS_GUILD,
  });
  addFlagOverride("scout_support_conversations_enabled", true, {});
  delivery.mockReset();
  delivery.mockResolvedValue(undefined);
});
afterAll(async () => {
  resetFlagOverrides("scout_operations_console_enabled");
  resetFlagOverrides("scout_support_conversations_enabled");
  await shutdownFeatureFlags();
  await dropTestDatabase(db, trpc.dbPath);
});
async function submit(body = "Please help.") {
  return await user.feedback.submit({
    body,
    submissionId: crypto.randomUUID(),
  });
}

test("read cursors never regress and do not swallow messages with equal timestamps", async () => {
  const saved = await submit();
  await operator.operations.inbox.reply({
    conversationId: saved.conversationId,
    requestId: crypto.randomUUID(),
    body: "First answer",
  });
  await operator.operations.inbox.reply({
    conversationId: saved.conversationId,
    requestId: crypto.randomUUID(),
    body: "Second answer",
  });
  const createdAt = new Date();
  await db.feedback.updateMany({ data: { createdAt } });
  const { messages } = await user.feedback.conversation({});
  const first = messages[1];
  const second = messages[2];
  if (first === undefined || second === undefined)
    throw new Error("Missing replies");
  await user.feedback.markRead({ messageId: first.id });
  const response1 = await user.feedback.unread();
  expect(response1.count).toBe(1);
  await user.feedback.markRead({ messageId: second.id });
  await user.feedback.markRead({ messageId: first.id });
  const response2 = await user.feedback.unread();
  expect(response2.count).toBe(0);
  await operator.operations.inbox.markRead({
    id: saved.conversationId,
    messageId: saved.id,
  });
  const newMessage = await submit("Another message");
  await db.feedback.update({
    where: { id: newMessage.id },
    data: { createdAt },
  });
  const response3 = await operator.operations.inbox.list({ unreadOnly: true });
  expect(response3.conversations).toHaveLength(1);
});
test("deleting contents cannot bypass a mute", async () => {
  const saved = await submit();
  await operator.operations.inbox.update({
    id: saved.conversationId,
    muted: true,
  });
  await user.feedback.deleteConversation({ confirmation: "DELETE" });
  expect(await db.feedback.count()).toBe(0);
  const response4 = await user.feedback.conversation({});
  expect(response4.conversation?.muted).toBe(true);
  await expect(submit("Bypass attempt")).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await operator.operations.inbox.update({
    id: saved.conversationId,
    muted: false,
  });
  await submit("Allowed after unmute");
});
test("automatic DM receipts work when new support controls are disabled", async () => {
  resetFlagOverrides("scout_support_conversations_enabled");
  const saved = await acceptSupportMessage({
    discordId: USER,
    body: "Help",
    source: "DISCORD_DM",
    discordMessageId: "100000000000099014",
  });
  await drainSupportJobs();
  expect(delivery).toHaveBeenCalledOnce();
  expect(delivery).toHaveBeenCalledWith(
    USER,
    expect.stringContaining("automatic receipt"),
  );
  const response5 = await db.supportConversation.findUniqueOrThrow({
    where: { id: saved.conversationId },
  });
  expect(response5.discordId).toBe(USER);
});
test("permanent contact works without subscriptions and after prompt dismissal", async () => {
  await user.feedback.dismiss();
  const response6 = await user.feedback.eligibility();
  expect(response6.shouldAsk).toBe(false);
  await submit();
  await submit("More details.");
  expect(await db.feedback.count()).toBe(2);
  expect(await db.supportConversation.count()).toBe(1);
  const response7 = await db.feedbackPromptState.findUniqueOrThrow({
    where: { discordId: USER },
  });
  expect(response7.submitted).toBe(true);
});
test("concurrent web retries save once and cannot overwrite another actor or body", async () => {
  const input = {
    body: "Original message",
    submissionId: crypto.randomUUID(),
  };
  const [first, retry] = await Promise.all([
    user.feedback.submit(input),
    user.feedback.submit(input),
  ]);
  expect(first).toEqual(retry);
  expect(await db.feedback.count()).toBe(1);
  await expect(operator.feedback.submit(input)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  await expect(
    user.feedback.submit({ ...input, body: "Changed" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.supportJob.count({ where: { kind: "ALERT" } })).toBe(1);
});
test("requires a web session, bounded text, or an owned ready screenshot", async () => {
  await expect(
    trpc.anonCaller().feedback.submit({ body: "Hello" }),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  for (const body of [" ", "x".repeat(4001)])
    await expect(user.feedback.submit({ body })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  await expect(
    user.feedback.submit({ body: "", attachmentIds: [crypto.randomUUID()] }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await db.feedback.count()).toBe(0);
});
test("web and Discord join one conversation without requiring a web account for DMs", async () => {
  const first = await submit("Web message");
  const second = await acceptSupportMessage({
    discordId: USER,
    body: "DM follow-up",
    source: "DISCORD_DM",
    discordMessageId: "100000000000099004",
  });
  expect(second.conversationId).toBe(first.conversationId);
  const history = await user.feedback.conversation({});
  expect(history.messages.map((message) => message.source)).toEqual([
    "WEB",
    "DISCORD_DM",
  ]);
  const page = await operator.operations.inbox.list({});
  expect(page.conversations).toHaveLength(1);
  expect(page.unreadCount).toBe(1);
  expect(await db.supportJob.count({ where: { kind: "ALERT" } })).toBe(1);
});
test("operations inbox stays available when the match console is off", async () => {
  resetFlagOverrides("scout_operations_console_enabled");
  const response8 = await operator.operations.inbox.availability();
  expect(response8.available).toBe(true);
  const response9 = await operator.operations.inbox.list({});
  expect(response9.conversations).toEqual([]);
  await expect(operator.operations.availability()).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});
test("ordinary members and server admins cannot inspect or modify another conversation", async () => {
  const saved = await submit();
  const outsider = trpc.authedCaller(OTHER);
  const response10 = await outsider.feedback.conversation({});
  expect(response10.messages).toEqual([]);
  await expect(
    outsider.feedback.markRead({ messageId: saved.id }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(user.operations.inbox.list({})).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(
    user.operations.inbox.detail({ id: saved.conversationId }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    user.operations.inbox.markRead({
      id: saved.conversationId,
      messageId: saved.id,
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    user.operations.inbox.reply({
      conversationId: saved.conversationId,
      requestId: crypto.randomUUID(),
      body: "Not allowed",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    trpc.anonCaller().operations.inbox.list({}),
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(delivery).not.toHaveBeenCalled();
});
test("replies are visible on web before Discord and retrying a reply never duplicates it", async () => {
  const saved = await submit();
  const input = {
    conversationId: saved.conversationId,
    requestId: crypto.randomUUID(),
    body: "We can help.",
  };
  const [first, replay] = await Promise.all([
    operator.operations.inbox.reply(input),
    operator.operations.inbox.reply(input),
  ]);
  expect(first.id).toBe(replay.id);
  expect(first.status).toBe("QUEUED");
  expect(delivery).not.toHaveBeenCalled();
  const response11 = await user.feedback.conversation({});
  expect(response11.messages.map((message) => message.body)).toEqual([
    "Please help.",
    "We can help.",
  ]);
  const response12 = await user.feedback.unread();
  expect(response12.count).toBe(1);
  await Promise.all([
    runSupportJob(`reply:${input.requestId}`),
    runSupportJob(`reply:${input.requestId}`),
  ]);
  expect(delivery).toHaveBeenCalledOnce();
  expect(delivery).toHaveBeenCalledWith(
    USER,
    expect.stringContaining(input.body),
  );
  const response13 = await db.feedbackReply.findUniqueOrThrow({
    where: { id: input.requestId },
  });
  expect(response13.status).toBe("SENT");
  const audit = await db.dmAuditLog.findFirstOrThrow();
  expect(audit.deliveryStatus).toBe("sent");
  expect(audit.content).not.toContain(input.body);
});
test("blocked DMs leave the human reply readable and are never automatically retried", async () => {
  delivery.mockRejectedValue(
    new DiscordAPIError(
      { message: "Cannot send messages", code: 50_007 },
      50_007,
      403,
      "POST",
      "/channels/messages",
      {},
    ),
  );
  const saved = await submit();
  const requestId = crypto.randomUUID();
  await operator.operations.inbox.reply({
    conversationId: saved.conversationId,
    requestId,
    body: "Available on the web.",
  });
  await runSupportJob(`reply:${requestId}`);
  await runSupportJob(`reply:${requestId}`);
  expect(delivery).toHaveBeenCalledOnce();
  const response14 = await db.feedbackReply.findUniqueOrThrow({
    where: { id: requestId },
  });
  expect(response14.status).toBe("DM_DISABLED");
  const response15 = await user.feedback.conversation({});
  expect(response15.messages.at(-1)?.body).toBe("Available on the web.");
  const response16 = await operator.operations.inbox.detail({
    id: saved.conversationId,
  });
  expect(response16.jobs[0]?.status).toBe("BLOCKED");
});
test("uncertain delivery is parked, not resent by recovery", async () => {
  delivery.mockRejectedValue(new Error("Connection lost after posting"));
  const saved = await submit();
  const requestId = crypto.randomUUID();
  await operator.operations.inbox.reply({
    conversationId: saved.conversationId,
    requestId,
    body: "Private reply",
  });
  await runSupportJob(`reply:${requestId}`);
  await runSupportJob(`reply:${requestId}`);
  expect(delivery).toHaveBeenCalledOnce();
  const response17 = await db.supportJob.findUniqueOrThrow({
    where: { id: `reply:${requestId}` },
  });
  expect(response17.status).toBe("UNKNOWN");
});
test("read is not resolved, replies wait on the user, and follow-ups reopen", async () => {
  const saved = await submit();
  await operator.operations.inbox.markRead({
    id: saved.conversationId,
    messageId: saved.id,
  });
  const response18 = await operator.operations.inbox.list({ unreadOnly: true });
  expect(response18.conversations).toHaveLength(0);
  const response19 = await operator.operations.inbox.list({
    needsReplyOnly: true,
  });
  expect(response19.conversations).toHaveLength(1);
  await operator.operations.inbox.reply({
    conversationId: saved.conversationId,
    requestId: crypto.randomUUID(),
    body: "Please provide a screenshot.",
  });
  const response20 = await user.feedback.conversation({});
  expect(response20.conversation?.status).toBe("WAITING_ON_USER");
  await operator.operations.inbox.update({
    id: saved.conversationId,
    status: "RESOLVED",
    category: "BUG",
  });
  await submit("Here is more information.");
  const response21 = await user.feedback.conversation({});
  expect(response21.conversation?.status).toBe("OPEN");
  const response22 = await operator.operations.inbox.detail({
    id: saved.conversationId,
  });
  expect(response22.conversation.category).toBe("BUG");
});
test("operator reply request ids cannot change body or conversation", async () => {
  const saved = await submit();
  const requestId = crypto.randomUUID();
  await operator.operations.inbox.reply({
    conversationId: saved.conversationId,
    requestId,
    body: "Original",
  });
  await expect(
    operator.operations.inbox.reply({
      conversationId: saved.conversationId,
      requestId,
      body: "Changed",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.feedbackReply.count()).toBe(1);
});
test("burst notifications are grouped and operator test submissions do not alert", async () => {
  await submit();
  await submit("Another line");
  expect(await db.supportJob.count({ where: { kind: "ALERT" } })).toBe(1);
  await operator.feedback.submit({ body: "Operator test" });
  expect(await db.supportJob.count({ where: { kind: "ALERT" } })).toBe(1);
  const job = await db.supportJob.findFirstOrThrow({
    where: { kind: "ALERT" },
  });
  await runSupportJob(job.id);
  expect(delivery).toHaveBeenCalledWith(
    OPERATOR,
    expect.stringContaining("/app/operations/inbox?conversation="),
  );
  expect(delivery.mock.calls[0]).not.toContain("Please help.");
});
test("rate limits and mute give useful errors without accepting messages", async () => {
  const saved = await submit();
  await operator.operations.inbox.update({
    id: saved.conversationId,
    muted: true,
  });
  await expect(submit()).rejects.toMatchObject({ code: "FORBIDDEN" });
  await operator.operations.inbox.update({
    id: saved.conversationId,
    muted: false,
  });
  for (let i = 0; i < 9; i += 1) await submit(`Line ${i.toString()}`);
  await expect(submit()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  expect(await db.feedback.count()).toBe(10);
});
test("message history cursors remain stable when timestamps tie", async () => {
  const saved = await submit();
  const createdAt = new Date("2026-10-01T00:00:00Z");
  await db.feedback.updateMany({ data: { createdAt } });
  await db.feedback.createMany({
    data: Array.from({ length: 54 }, (_, i) => ({
      discordId: USER,
      conversationId: saved.conversationId,
      body: `Older message ${i.toString()}`,
      createdAt,
    })),
  });
  const first = await user.feedback.conversation({});
  expect(first.messages).toHaveLength(50);
  if (first.nextCursor === null) throw new Error("Expected history cursor");
  const second = await user.feedback.conversation({
    cursor: first.nextCursor,
  });
  expect(second.messages).toHaveLength(5);
  expect(
    new Set(
      [...first.messages, ...second.messages].map((message) => message.id),
    ).size,
  ).toBe(55);
});
test("owned screenshots support image-only messages; foreign images cannot attach", async () => {
  const saved = await submit();
  const id = crypto.randomUUID();
  await db.supportAttachment.create({
    data: {
      id,
      conversationId: saved.conversationId,
      name: "screenshot.png",
      contentType: "image/png",
      size: 100,
      objectKey: `private/${id}`,
      status: "STORED",
    },
  });
  await expect(
    trpc.authedCaller(OTHER).feedback.submit({ body: "", attachmentIds: [id] }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await user.feedback.submit({ body: "", attachmentIds: [id] });
  const response23 = await user.feedback.conversation({});
  const latest = response23.messages.at(-1);
  expect(latest?.body).toBe("");
  expect(latest?.screenshots[0]?.id).toBe(id);
  expect(JSON.stringify(latest)).not.toContain("private/");
});
test("manual deletion removes messages and replies and stops queued work", async () => {
  const saved = await submit();
  const requestId = crypto.randomUUID();
  await operator.operations.inbox.reply({
    conversationId: saved.conversationId,
    requestId,
    body: "Private reply",
  });
  await expect(
    Reflect.apply(user.feedback.deleteConversation, user.feedback, [
      { confirmation: "wrong" },
    ]),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await user.feedback.deleteConversation({ confirmation: "DELETE" });
  expect(await db.feedback.count()).toBe(0);
  expect(await db.feedbackReply.count()).toBe(0);
  await runSupportJob(`reply:${requestId}`);
  expect(delivery).not.toHaveBeenCalled();
  const response24 = await user.feedback.conversation({});
  expect(response24.messages).toEqual([]);
  await submit("Start again");
  expect(await db.supportConversation.count()).toBe(1);
});
test("stats exclude operator tests and do not contain message contents", async () => {
  await submit("Private secret content");
  await operator.feedback.submit({ body: "Testing" });
  const stats = await operator.operations.inbox.stats();
  expect(stats.contributors).toBe(1);
  expect(JSON.stringify(stats)).not.toContain("Private secret content");
});
test("stale non-repeatable work becomes unknown rather than queued", async () => {
  const saved = await submit();
  await db.supportJob.updateMany({
    where: { conversationId: saved.conversationId },
    data: { status: "SENDING", updatedAt: new Date("2026-01-01") },
  });
  await drainSupportJobs();
  const response25 = await db.supportJob.findFirstOrThrow();
  expect(response25.status).toBe("UNKNOWN");
  expect(delivery).not.toHaveBeenCalled();
});
