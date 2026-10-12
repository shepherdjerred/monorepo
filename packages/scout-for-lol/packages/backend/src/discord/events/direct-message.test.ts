import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { ChannelType, Collection } from "discord.js";
import { mockMessage } from "#src/testing/discord-mocks.ts";
import {
  createTestDatabase,
  dropTestDatabase,
} from "#src/testing/test-database.ts";
import { testAccountId, testChannelId } from "#src/testing/test-ids.ts";

const receipt = vi.fn(() => Promise.resolve("sent"));
vi.mock("#src/discord/utils/dm.ts", () => ({ sendDM: receipt }));
const { handleSupportDirectMessage } =
  await import("#src/discord/events/direct-message.ts");
const { prisma, dbPath } = createTestDatabase("support-dm");
const USER = testAccountId("991001");
const CHANNEL = testChannelId("991002");
function message(overrides: Record<string, unknown> = {}) {
  return mockMessage({
    id: "100000000000099001",
    author: { id: USER, username: "player", bot: false },
    channel: { type: ChannelType.DM },
    channelId: CHANNEL,
    content: "Scout stopped posting my reports.",
    attachments: new Collection(),
    createdAt: new Date(),
    ...overrides,
  });
}
beforeEach(async () => {
  await prisma.supportJob.deleteMany();
  await prisma.supportConversation.deleteMany();
  await prisma.supportSenderThrottle.deleteMany();
  receipt.mockClear();
});
afterAll(async () => {
  await dropTestDatabase(prisma, dbPath);
});
afterEach(() => {
  vi.restoreAllMocks();
});
describe("Scout support DMs", () => {
  test("a storage failure sends a failure notice, never a saved receipt", async () => {
    const failure = new Error("Storage unavailable");
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(failure);
    await expect(handleSupportDirectMessage(message(), prisma)).rejects.toBe(
      failure,
    );
    expect(receipt).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("couldn't save your message"),
      }),
    );
    expect(await prisma.feedback.count()).toBe(0);
    expect(await prisma.supportJob.count()).toBe(0);
  });
  test("stores before durable acknowledgement, even without a web account", async () => {
    await handleSupportDirectMessage(message(), prisma);
    expect(await prisma.feedback.findFirstOrThrow()).toMatchObject({
      source: "DISCORD_DM",
      discordId: USER,
      discordUsername: "player",
      body: "Scout stopped posting my reports.",
      discordChannelId: CHANNEL,
    });
    expect(await prisma.user.count()).toBe(0);
    expect(
      await prisma.supportJob.count({
        where: { kind: "ACKNOWLEDGEMENT", status: "QUEUED" },
      }),
    ).toBe(1);
    expect(receipt).not.toHaveBeenCalled();
  });
  test("concurrent gateway replays store and queue acknowledgement once", async () => {
    await Promise.all([
      handleSupportDirectMessage(message(), prisma),
      handleSupportDirectMessage(message(), prisma),
    ]);
    expect(await prisma.feedback.count()).toBe(1);
    expect(
      await prisma.supportJob.count({ where: { kind: "ACKNOWLEDGEMENT" } }),
    ).toBe(1);
  });
  test("multiple lines share one thread, receipt, and owner alert", async () => {
    await handleSupportDirectMessage(message(), prisma);
    await handleSupportDirectMessage(
      message({ id: "100000000000099002", content: "More details." }),
      prisma,
    );
    expect(await prisma.supportConversation.count()).toBe(1);
    expect(await prisma.feedback.count()).toBe(2);
    expect(
      await prisma.supportJob.count({ where: { kind: "ACKNOWLEDGEMENT" } }),
    ).toBe(1);
    expect(await prisma.supportJob.count({ where: { kind: "ALERT" } })).toBe(1);
  });
  test("ignores guild messages, bots, and empty DMs", async () => {
    await handleSupportDirectMessage(
      message({ channel: { type: ChannelType.GuildText } }),
      prisma,
    );
    await handleSupportDirectMessage(
      message({ author: { id: USER, bot: true } }),
      prisma,
    );
    await handleSupportDirectMessage(message({ content: " " }), prisma);
    expect(await prisma.feedback.count()).toBe(0);
    expect(receipt).not.toHaveBeenCalled();
  });
  test("image-only DMs keep private metadata and queue archival", async () => {
    const file = {
      id: "100000000000099003",
      name: "screenshot.png",
      size: 123,
      url: "https://cdn.discordapp.com/attachments/991002/991003/screenshot.png",
      contentType: "image/png",
    };
    await handleSupportDirectMessage(
      message({ content: "", attachments: new Collection([[file.id, file]]) }),
      prisma,
    );
    const response1 = await prisma.feedback.findFirstOrThrow();
    expect(response1.body).toBe("");
    const image = await prisma.supportAttachment.findFirstOrThrow();
    expect(image).toMatchObject({
      name: file.name,
      sourceUrl: file.url,
      status: "PENDING",
    });
    expect(
      await prisma.supportJob.count({
        where: { kind: "ARCHIVE", attachmentId: image.id },
      }),
    ).toBe(1);
  });
  test("unsupported attachments get a useful notice without losing text", async () => {
    const file = {
      id: "100000000000099003",
      name: "document.pdf",
      size: 123,
      url: "https://cdn.discordapp.com/attachments/991002/991003/document.pdf",
      contentType: "application/pdf",
    };
    await handleSupportDirectMessage(
      message({ attachments: new Collection([[file.id, file]]) }),
      prisma,
    );
    expect(await prisma.feedback.count()).toBe(1);
    expect(await prisma.supportAttachment.count()).toBe(0);
    expect(receipt).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("some attachments were not"),
      }),
    );
  });
  test("oversized text gets an explicit refusal instead of a silent drop", async () => {
    await handleSupportDirectMessage(
      message({ content: "x".repeat(4001) }),
      prisma,
    );
    expect(await prisma.feedback.count()).toBe(0);
    expect(receipt).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("not saved"),
      }),
    );
  });
  test("coalesces repeated rejection notices per sender", async () => {
    for (let index = 0; index < 10; index++) {
      await handleSupportDirectMessage(
        message({ id: `1000000000000990${String(index).padStart(2, "0")}` }),
        prisma,
      );
    }
    const firstRejectedMessage = message({ id: "100000000000099099" });
    await handleSupportDirectMessage(firstRejectedMessage, prisma);
    await handleSupportDirectMessage(
      message({ id: "100000000000099100" }),
      prisma,
    );
    expect(receipt).toHaveBeenCalledTimes(1);
    expect(await prisma.feedback.count()).toBe(10);
  });
  test("charges Discord screenshots to the shared sender upload quota", async () => {
    for (let index = 0; index < 6; index++) {
      const attachmentId = `1000000000000990${String(index + 10).padStart(2, "0")}`;
      const file = {
        id: attachmentId,
        name: `screenshot-${String(index)}.png`,
        size: 123,
        url: `https://cdn.discordapp.com/attachments/991002/${attachmentId}/screenshot.png`,
        contentType: "image/png",
      };
      await handleSupportDirectMessage(
        message({
          id: `1000000000000991${String(index).padStart(2, "0")}`,
          attachments: new Collection([[file.id, file]]),
        }),
        prisma,
      );
    }

    expect(await prisma.feedback.count()).toBe(5);
    expect(await prisma.supportAttachment.count()).toBe(5);
    expect(receipt).toHaveBeenCalledTimes(1);
    expect(receipt).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("more screenshots"),
      }),
    );
  });
});
