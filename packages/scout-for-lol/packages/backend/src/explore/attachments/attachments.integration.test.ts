import { DiscordAccountIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  DeleteObjectCommand,
  type GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import configuration from "#src/configuration.ts";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import { dropTestDatabase } from "#src/testing/test-database.ts";
import { testAccountId } from "#src/testing/test-ids.ts";
import { signSession } from "#src/trpc/jwt.ts";

// Only the object store is faked; ownership, limits and cleanup run real SQL.
const objects = new Map<string, Uint8Array>();
const storage = vi.fn(
  (command: GetObjectCommand | PutObjectCommand | DeleteObjectCommand) => {
    const key = command.input.Key;
    if (key === undefined) throw new Error("Missing storage key");
    if (command instanceof PutObjectCommand) {
      if (!(command.input.Body instanceof Uint8Array))
        throw new TypeError("Expected bytes");
      objects.set(key, command.input.Body);
      return Promise.resolve({});
    }
    if (command instanceof DeleteObjectCommand) {
      objects.delete(key);
      return Promise.resolve({});
    }
    const bytes = objects.get(key);
    if (bytes === undefined) throw new Error("Missing object");
    return Promise.resolve({
      Body: {
        transformToWebStream: () =>
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
      },
    });
  },
);
vi.doMock("#src/storage/s3-client.ts", () => ({
  createS3Client: () => ({ send: storage }),
}));
const harness = await createOfflineTrpcHarness("explore-attachments");
const db = harness.prisma;
const {
  claimExploreAttachments,
  discardExploreAttachment,
  holdExploreAttachments,
  loadQuestionImages,
  storeExploreAttachment,
} = await import("#src/explore/attachments/storage.ts");
const { collectUnsentExploreAttachments } =
  await import("#src/explore/attachments/cleanup.ts");
const { handleExploreAttachment } =
  await import("#src/explore/attachments/http.ts");
const { deleteExploreConversation } = await import("#src/explore/store.ts");
const { runSupportJob } = await import("#src/support/jobs.ts");

const OWNER = testAccountId("999301");
const STRANGER = testAccountId("999302");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6QAAAABJRU5ErkJggg==",
  "base64",
);

async function upload(owner = OWNER) {
  return await storeExploreAttachment(db, owner, {
    mediaType: "image/png",
    bytes: png,
  });
}

async function question(owner = OWNER) {
  const conversation = await db.exploreConversation.create({
    data: {
      userId: owner,
      title: "Scoreboard",
      messages: { create: { role: "user", content: "What went wrong?" } },
    },
    include: { messages: true },
  });
  const message = conversation.messages[0];
  if (message === undefined) throw new Error("Expected a question");
  return { conversationId: conversation.id, questionId: message.id };
}

async function fetchImage(id: string, userId?: string) {
  const url = new URL(`http://localhost/api/explore/attachments/${id}`);
  const headers: Record<string, string> = {};
  if (userId !== undefined) {
    const session = await signSession({
      discordId: DiscordAccountIdSchema.parse(userId),
    });
    headers["Cookie"] = `scout_session=${session.jwt}`;
  }
  const response = await handleExploreAttachment(
    new Request(url.toString(), { headers }),
    url,
  );
  if (response === null) throw new Error("Expected an image response");
  return response;
}

beforeAll(async () => {
  await initFeatureFlags({ environment: { FEATURE_FLAGS_MODE: "disabled" } });
  vi.spyOn(configuration, "supportBucketName", "get").mockReturnValue(
    "support-test",
  );
  for (const discordId of [OWNER, STRANGER])
    await db.user.upsert({
      where: { discordId },
      create: { discordId, discordUsername: "fixture" },
      update: {},
    });
});

beforeEach(async () => {
  await db.supportJob.deleteMany();
  await db.exploreAttachment.deleteMany();
  await db.exploreAttachmentUpload.deleteMany();
  await db.exploreConversation.deleteMany();
  objects.clear();
});

afterAll(async () => {
  vi.restoreAllMocks();
  await shutdownFeatureFlags();
  await dropTestDatabase(db, harness.dbPath);
});

describe("Explore image attachments", () => {
  test("an upload is stored privately and read back verified", async () => {
    const attachment = await upload();
    const { questionId } = await question();
    expect(
      await claimExploreAttachments(db, {
        ids: [attachment.id],
        ownerId: OWNER,
        questionId,
      }),
    ).toBe(true);
    const images = await loadQuestionImages(db, questionId);
    expect(images).toHaveLength(1);
    expect(Buffer.from(images[0]?.bytes ?? []).equals(png)).toBe(true);
    expect([...objects.keys()]).toEqual([`explore/${OWNER}/${attachment.id}`]);
  });

  test("a question cannot claim a stranger's or an already-sent image", async () => {
    const mine = await upload();
    const theirs = await upload(STRANGER);
    const first = await question();
    expect(
      await claimExploreAttachments(db, {
        ids: [theirs.id],
        ownerId: OWNER,
        questionId: first.questionId,
      }),
    ).toBe(false);
    await claimExploreAttachments(db, {
      ids: [mine.id],
      ownerId: OWNER,
      questionId: first.questionId,
    });
    const second = await question();
    expect(
      await claimExploreAttachments(db, {
        ids: [mine.id],
        ownerId: OWNER,
        questionId: second.questionId,
      }),
    ).toBe(false);
  });

  test("unsent uploads are capped per person", async () => {
    for (let index = 0; index < 8; index++) await upload();
    await expect(upload()).rejects.toThrow(/Send or remove/);
  });

  test("an image is served only to its owner", async () => {
    const attachment = await upload();
    const mine = await fetchImage(attachment.id, OWNER);
    expect(mine.status).toBe(200);
    expect(mine.headers.get("Content-Type")).toBe("image/png");
    const theirs = await fetchImage(attachment.id, STRANGER);
    expect(theirs.status).toBe(404);
    const signedOut = await fetchImage(attachment.id);
    expect(signedOut.status).toBe(401);
  });

  test("deleting the conversation deletes its images", async () => {
    const attachment = await upload();
    const { conversationId, questionId } = await question();
    await claimExploreAttachments(db, {
      ids: [attachment.id],
      ownerId: OWNER,
      questionId,
    });
    expect(await deleteExploreConversation(db, conversationId, OWNER)).toBe(
      true,
    );
    expect(await db.exploreAttachment.count()).toBe(0);
    await runSupportJob(`delete:explore:${attachment.id}`);
    expect(objects.size).toBe(0);
  });

  test("uploads nobody sent are collected after a day", async () => {
    const stale = await upload();
    const fresh = await upload();
    const held = await upload();
    const dayAgo = new Date(Date.now() - 25 * 60 * 60_000);
    await db.exploreAttachment.update({
      where: { id: stale.id },
      data: { createdAt: dayAgo, heldUntil: dayAgo },
    });
    // Old, but a composer still holds it.
    await db.exploreAttachment.update({
      where: { id: held.id },
      data: { createdAt: dayAgo },
    });
    expect(await collectUnsentExploreAttachments(db)).toBe(1);
    const remaining = await db.exploreAttachment.findMany();
    expect(remaining.map((row) => row.id).toSorted()).toEqual(
      [fresh.id, held.id].toSorted(),
    );
    expect(
      await db.supportJob.findUnique({
        where: { id: `delete:explore:${stale.id}` },
      }),
    ).not.toBeNull();
  });

  test("removing an unsent image frees its slot and queues its object", async () => {
    for (let index = 0; index < 8; index++) await upload();
    const [first] = await db.exploreAttachment.findMany({ take: 1 });
    if (first === undefined) throw new Error("Expected an upload");
    expect(await discardExploreAttachment(db, OWNER, first.id)).toBe(true);
    await expect(upload()).resolves.toMatchObject({ mediaType: "image/png" });
    expect(
      await db.supportJob.findUnique({
        where: { id: `delete:explore:${first.id}` },
      }),
    ).not.toBeNull();
  });

  test("uploads whose hold lapsed stop holding slots", async () => {
    for (let index = 0; index < 8; index++) await upload();
    await db.exploreAttachment.updateMany({
      data: { heldUntil: new Date(Date.now() - 60_000) },
    });
    await expect(upload()).resolves.toMatchObject({ mediaType: "image/png" });
    expect(
      await db.exploreAttachment.count({ where: { questionId: null } }),
    ).toBe(1);
  });

  test("uploads a composer still holds, in any tab, are not reclaimed", async () => {
    const shown = [];
    for (let index = 0; index < 8; index++) shown.push(await upload());
    await db.exploreAttachment.updateMany({
      data: { heldUntil: new Date(Date.now() - 60_000) },
    });
    // Another tab renews what it shows; this tab's upload must not take it.
    await holdExploreAttachments(
      db,
      OWNER,
      shown.map((attachment) => attachment.id),
    );
    await expect(upload()).rejects.toThrow(/Send or remove/);
    expect(
      await db.exploreAttachment.count({ where: { questionId: null } }),
    ).toBe(8);
  });

  test("a stranger cannot discard an upload, nor anyone a sent one", async () => {
    const attachment = await upload();
    expect(await discardExploreAttachment(db, STRANGER, attachment.id)).toBe(
      false,
    );
    const { questionId } = await question();
    await claimExploreAttachments(db, {
      ids: [attachment.id],
      ownerId: OWNER,
      questionId,
    });
    expect(await discardExploreAttachment(db, OWNER, attachment.id)).toBe(
      false,
    );
  });

  test("deleting conversations does not reset the hourly upload limit", async () => {
    await db.exploreAttachmentUpload.createMany({
      data: Array.from({ length: 40 }, () => ({ ownerId: OWNER })),
    });
    await expect(upload()).rejects.toThrow(/this hour/);
  });

  test("a question keeps its images in the order they were attached", async () => {
    const first = await upload();
    const second = await upload();
    // Stored in the opposite order to the question's.
    await db.exploreAttachment.update({
      where: { id: second.id },
      data: { createdAt: new Date(Date.now() - 60_000) },
    });
    const { questionId } = await question();
    await claimExploreAttachments(db, {
      ids: [first.id, second.id],
      ownerId: OWNER,
      questionId,
    });
    const rows = await db.exploreAttachment.findMany({
      where: { questionId },
      orderBy: { position: "asc" },
    });
    expect(rows.map((row) => row.id)).toEqual([first.id, second.id]);
  });

  test("a failed object write keeps the object queued for deletion", async () => {
    storage.mockImplementationOnce(() =>
      Promise.reject(new Error("lost reply")),
    );
    await expect(upload()).rejects.toThrow("lost reply");
    expect(await db.exploreAttachment.count()).toBe(0);
    expect(
      await db.supportJob.count({ where: { kind: "DELETE_OBJECT" } }),
    ).toBe(1);
  });
});
