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
const { claimExploreAttachments, loadQuestionImages, storeExploreAttachment } =
  await import("#src/explore/attachments/storage.ts");
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
    await db.exploreAttachment.update({
      where: { id: stale.id },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60_000) },
    });
    expect(await collectUnsentExploreAttachments(db)).toBe(1);
    const remaining = await db.exploreAttachment.findMany();
    expect(remaining.map((row) => row.id)).toEqual([fresh.id]);
    expect(
      await db.supportJob.findUnique({
        where: { id: `delete:explore:${stale.id}` },
      }),
    ).not.toBeNull();
  });
});
