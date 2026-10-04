import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { GetObjectCommand } from "@aws-sdk/client-s3";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import { dropTestDatabase } from "#src/testing/test-database.ts";
import { testAccountId } from "#src/testing/test-ids.ts";
import configuration from "#src/configuration.ts";
import {
  addFlagOverride,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { SCOUT_OPERATOR_IDS } from "#src/operations/operator-allowlist.ts";
import { signSession } from "#src/trpc/jwt.ts";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

// Mock only the external storage port; exercise real SQL, CSRF, cookie auth,
// ownership, deletion fencing, and the production archive/outbox code.
const objects = new Map<string, Uint8Array>();
const storage = vi.fn(
  async (
    command: GetObjectCommand | PutObjectCommand | DeleteObjectCommand,
  ) => {
    const key = command.input.Key;
    if (key === undefined) throw new Error("Missing storage key");
    if (command instanceof PutObjectCommand) {
      if (!(command.input.Body instanceof Uint8Array))
        throw new Error("Expected bytes");
      objects.set(key, command.input.Body);
      return {};
    }
    if (command instanceof DeleteObjectCommand) {
      objects.delete(key);
      return {};
    }
    const bytes = objects.get(key);
    if (bytes === undefined) throw new Error("Missing object");
    return {
      Body: {
        transformToWebStream: () =>
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
      },
    };
  },
);
const normalStorage = storage.getMockImplementation();
if (normalStorage === undefined) throw new Error("Missing storage fixture");
vi.doMock("#src/storage/s3-client.ts", () => ({
  createS3Client: () => ({ send: storage }),
}));
const harness = await createOfflineTrpcHarness("support-screenshots");
const db = harness.prisma;
const { validateScreenshot, DiscordScreenshotSchema, MAX_SCREENSHOT_BYTES } =
  await import("#src/support/screenshots.ts");
const { acceptSupportMessage, deleteSupportConversation } =
  await import("#src/support/conversations.ts");
const { runSupportJob } = await import("#src/support/jobs.ts");
const { handleSupportScreenshot } = await import("#src/support/http.ts");
const { createContext } = await import("#src/trpc/context.ts");
const USER = testAccountId("999102");
const OTHER = testAccountId("999103");
const [OPERATOR] = SCOUT_OPERATOR_IDS;
if (OPERATOR === undefined) throw new Error("Missing operator");
let caller = harness.authedCaller(USER);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6QAAAABJRU5ErkJggg==",
  "base64",
);
function uploadInput(id = crypto.randomUUID()) {
  return {
    id,
    name: "screenshot.png",
    contentType: "image/png" as const,
    base64: png.toString("base64"),
  };
}
async function imageRequest(id: string, userId?: string) {
  const url = new URL(`http://localhost/api/support/screenshots/${id}`);
  const headers: Record<string, string> = {};
  if (userId !== undefined) {
    const session = await signSession({ discordId: userId });
    headers["Cookie"] = `scout_session=${session.jwt}`;
  }
  const response = await handleSupportScreenshot(
    new Request(url.toString(), { headers }),
    url,
  );
  if (response === null) throw new Error("Expected screenshot response");
  return response;
}
beforeAll(async () => {
  await initFeatureFlags({ environment: { FEATURE_FLAGS_MODE: "disabled" } });
  vi.spyOn(configuration, "supportBucketName", "get").mockReturnValue(
    "support-test",
  );
  vi.spyOn(configuration, "webAppOrigin", "get").mockReturnValue(
    "http://localhost",
  );
  for (const discordId of [USER, OTHER, OPERATOR])
    await db.user.upsert({
      where: { discordId },
      create: { discordId, discordUsername: "fixture" },
      update: {},
    });
});
beforeEach(async () => {
  caller = harness.authedCaller(USER);
  await db.supportJob.deleteMany();
  await db.supportSenderThrottle.deleteMany();
  await db.supportConversation.deleteMany();
  await db.feedback.deleteMany();
  await db.feedbackPromptState.deleteMany();
  objects.clear();
  storage.mockReset();
  storage.mockImplementation(normalStorage);
  resetFlagOverrides("scout_support_conversations_enabled");
  addFlagOverride("scout_support_conversations_enabled", true, {});
});
afterAll(async () => {
  vi.restoreAllMocks();
  resetFlagOverrides("scout_support_conversations_enabled");
  await shutdownFeatureFlags();
  await dropTestDatabase(db, harness.dbPath);
});

async function postUpload(headers: Record<string, string>) {
  return await fetchRequestHandler({
    endpoint: "/trpc",
    router: harness.appRouter,
    createContext: ({ req }) => createContext(req),
    req: new Request("http://localhost/trpc/feedback.uploadScreenshot", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(uploadInput()),
    }),
  });
}

test("deleting a conversation does not reset the sender message throttle", async () => {
  let conversationId: string | undefined;
  for (let index = 0; index < 10; index += 1) {
    const accepted = await acceptSupportMessage({
      discordId: USER,
      body: `Message ${String(index)}`,
      source: "DISCORD_DM",
      discordMessageId: `100000000000001${String(index).padStart(3, "0")}`,
    });
    conversationId = accepted.conversationId;
  }
  if (conversationId === undefined) throw new Error("Missing conversation");
  await deleteSupportConversation(conversationId);

  await expect(
    acceptSupportMessage({
      discordId: USER,
      body: "One more message",
      source: "DISCORD_DM",
      discordMessageId: "100000000000002000",
    }),
  ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
});

test("deleting a conversation preserves alert and DM receipt grouping", async () => {
  const first = await acceptSupportMessage({
    discordId: USER,
    body: "First message",
    source: "DISCORD_DM",
    discordMessageId: "100000000000003001",
  });
  await deleteSupportConversation(first.conversationId);
  await acceptSupportMessage({
    discordId: USER,
    body: "Follow-up after deletion",
    source: "DISCORD_DM",
    discordMessageId: "100000000000003002",
  });

  expect(await db.supportJob.count({ where: { kind: "ALERT" } })).toBe(1);
  expect(
    await db.supportJob.count({ where: { kind: "ACKNOWLEDGEMENT" } }),
  ).toBe(1);
});

test("HTTP uploads require a signed session, matching CSRF token, and same origin", async () => {
  const session = await signSession({ discordId: USER });
  const anonymous = await postUpload({});
  expect(anonymous.status).toBe(401);
  const cookie = `scout_session=${session.jwt}; scout_csrf=csrf`;
  const missingCsrf = await postUpload({ Cookie: cookie });
  expect(missingCsrf.status).toBe(403);
  const wrongCsrf = await postUpload({
    Cookie: cookie,
    "x-csrf-token": "wrong",
  });
  expect(wrongCsrf.status).toBe(403);
  const wrongOrigin = await postUpload({
    Cookie: cookie,
    "x-csrf-token": "csrf",
    Origin: "http://evil.test",
  });
  expect(wrongOrigin.status).toBe(403);
  const valid = await postUpload({
    Cookie: cookie,
    "x-csrf-token": "csrf",
    ...(configuration.webAppOrigin === undefined
      ? {}
      : { Origin: configuration.webAppOrigin }),
  });
  expect(valid.status).toBe(200);
  expect(storage).toHaveBeenCalledOnce();
});

test("support driver failures do not expose submitted text in HTTP errors", async () => {
  const session = await signSession({ discordId: USER });
  const failure = vi
    .spyOn(db, "$transaction")
    .mockRejectedValueOnce(
      new Error("Database query contained PRIVATE_MESSAGE_CONTENT"),
    );
  try {
    const response = await postUpload({
      Cookie: `scout_session=${session.jwt}; scout_csrf=csrf`,
      "x-csrf-token": "csrf",
      Origin: "http://localhost",
    });
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain("temporarily unavailable");
    expect(body).not.toContain("PRIVATE_MESSAGE_CONTENT");
  } finally {
    failure.mockRestore();
  }
});
test("deletion waits for an in-flight upload and then removes its tracked object", async () => {
  const entered = Promise.withResolvers<boolean>();
  const released = Promise.withResolvers<boolean>();
  const original = storage.getMockImplementation();
  if (original === undefined) throw new Error("Missing storage fixture");
  storage.mockImplementationOnce(async (command) => {
    entered.resolve(true);
    await released.promise;
    return await original(command);
  });
  const input = uploadInput();
  const upload = caller.feedback.uploadScreenshot(input);
  await entered.promise;
  const deletion = caller.feedback.deleteConversation({
    confirmation: "DELETE",
  });
  released.resolve(true);
  await Promise.all([upload, deletion]);
  expect(await db.supportAttachment.count()).toBe(0);
  await runSupportJob(`delete:${input.id}`);
  expect(objects.size).toBe(0);
});
test("accepts image bytes, refuses spoofed MIME, excessive bytes, and non-Discord downloads", () => {
  expect(() => validateScreenshot(png, "image/png")).not.toThrow();
  expect(() => validateScreenshot(png, "image/jpeg")).toThrow();
  expect(() =>
    validateScreenshot(new Uint8Array(MAX_SCREENSHOT_BYTES + 1), "image/png"),
  ).toThrow();
  expect(() =>
    validateScreenshot(Buffer.from("<svg>script</svg>"), "image/png"),
  ).toThrow();
  for (const url of [
    "http://cdn.discordapp.com/attachments/a/b",
    "https://evil.test/attachments/a/b",
    "https://cdn.discordapp.com.evil.test/attachments/a/b",
    "https://cdn.discordapp.com:444/attachments/a/b",
    "https://user@cdn.discordapp.com/attachments/a/b",
    "https://cdn.discordapp.com/private",
  ]) {
    expect(DiscordScreenshotSchema.shape.url.safeParse(url).success).toBe(
      false,
    );
  }
  expect(
    DiscordScreenshotSchema.shape.url.safeParse(
      "https://cdn.discordapp.com/attachments/a/b.png?ex=expiry",
    ).success,
  ).toBe(true);
});
test("upload retries reuse a private key but cannot change content or ownership", async () => {
  const input = uploadInput();
  expect(await caller.feedback.uploadScreenshot(input)).toEqual({
    id: input.id,
  });
  await caller.feedback.uploadScreenshot(input);
  expect(storage).toHaveBeenCalledOnce();
  await expect(
    caller.feedback.uploadScreenshot({ ...input, name: "changed.png" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const changed = Buffer.from(png);
  changed[30] = 1;
  await expect(
    caller.feedback.uploadScreenshot({
      ...input,
      base64: changed.toString("base64"),
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    harness.authedCaller(OTHER).feedback.uploadScreenshot(input),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const saved = await db.supportAttachment.findUniqueOrThrow({
    where: { id: input.id },
  });
  expect(saved.status).toBe("STORED");
  expect(saved.digest).toHaveLength(64);
  expect(saved.sourceUrl).toBeNull();
});
test("cookie-authenticated owner and operator get bytes; strangers, malformed cookies, and admins do not", async () => {
  const input = uploadInput();
  await caller.feedback.uploadScreenshot(input);
  const response1 = await imageRequest(input.id);
  expect(response1.status).toBe(401);
  const response2 = await imageRequest(input.id, OTHER);
  expect(response2.status).toBe(404);
  const owner = await imageRequest(input.id, USER);
  expect(owner.status).toBe(200);
  expect(owner.headers.get("Cache-Control")).toBe("private, no-store");
  expect(owner.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(Buffer.from(await owner.arrayBuffer())).toEqual(png);
  const response3 = await imageRequest(input.id, OPERATOR);
  expect(response3.status).toBe(200);
  const url = new URL(`http://localhost/api/support/screenshots/${input.id}`);
  const response4 = await handleSupportScreenshot(
    new Request(url.toString(), { method: "POST" }),
    url,
  );
  expect(response4?.status).toBe(405);
  const response5 = await handleSupportScreenshot(
    new Request(url.toString(), {
      headers: { Cookie: "scout_session=invalid" },
    }),
    url,
  );
  expect(response5?.status).toBe(401);
  const saved = await db.supportAttachment.findUniqueOrThrow({
    where: { id: input.id },
  });
  objects.set(saved.objectKey, new Uint8Array(20));
  const response6 = await imageRequest(input.id, USER);
  expect(response6.status).toBe(503);
});
test("upload outages leave a tracked reservation that the same request can recover", async () => {
  const input = uploadInput();
  storage.mockRejectedValueOnce(new Error("Storage unavailable"));
  await expect(caller.feedback.uploadScreenshot(input)).rejects.toThrow();
  const response7 = await db.supportAttachment.findUniqueOrThrow({
    where: { id: input.id },
  });
  expect(response7.status).toBe("PENDING");
  await caller.feedback.uploadScreenshot(input);
  expect(objects.size).toBe(1);
});
test("deleting a conversation does not reset the sender screenshot upload limit", async () => {
  let conversationId: string | undefined;
  for (let index = 0; index < 5; index += 1) {
    const upload = uploadInput();
    await caller.feedback.uploadScreenshot(upload);
    const attachment = await db.supportAttachment.findUniqueOrThrow({
      where: { id: upload.id },
    });
    conversationId = attachment.conversationId;
  }
  if (conversationId === undefined) throw new Error("Missing conversation");
  await deleteSupportConversation(conversationId);

  await expect(
    caller.feedback.uploadScreenshot(uploadInput()),
  ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
});
test("accepted files cannot be removed as drafts; deletion durably cleans private objects", async () => {
  const input = uploadInput();
  await caller.feedback.uploadScreenshot(input);
  const saved = await caller.feedback.submit({
    body: "",
    attachmentIds: [input.id],
    submissionId: crypto.randomUUID(),
  });
  await expect(
    harness.authedCaller(OTHER).feedback.removeScreenshot({ id: input.id }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await caller.feedback.removeScreenshot({ id: input.id })).toEqual({
    removed: false,
    saved: true,
  });
  expect(await db.supportAttachment.count()).toBe(1);
  await deleteSupportConversation(saved.conversationId);
  const response8 = await imageRequest(input.id, USER);
  expect(response8.status).toBe(404);
  expect(objects.size).toBe(1);
  await runSupportJob(`delete:${input.id}`);
  expect(objects.size).toBe(0);
});
test("bot images archive privately and clear expiring links; deleted queued archives never download", async () => {
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => new Response(png));
  try {
    const saved = await acceptSupportMessage({
      discordId: USER,
      body: "",
      source: "DISCORD_DM",
      discordMessageId: "100000000000099102",
      discordAttachments: [
        {
          name: "screen.png",
          size: png.length,
          contentType: "image/png",
          url: "https://cdn.discordapp.com/attachments/a/b.png",
        },
      ],
    });
    const file = await db.supportAttachment.findFirstOrThrow();
    await runSupportJob(`archive:${file.id}`);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ redirect: "error" }),
    );
    const stored = await db.supportAttachment.findUniqueOrThrow({
      where: { id: file.id },
    });
    expect(stored.status).toBe("STORED");
    expect(stored.sourceUrl).toBeNull();
    const response9 = await imageRequest(file.id, USER);
    expect(response9.status).toBe(200);
    const second = await acceptSupportMessage({
      discordId: USER,
      body: "",
      source: "DISCORD_DM",
      discordMessageId: "100000000000099103",
      discordAttachments: [
        {
          name: "screen.png",
          size: png.length,
          contentType: "image/png",
          url: "https://cdn.discordapp.com/attachments/a/c.png",
        },
      ],
    });
    expect(second.conversationId).toBe(saved.conversationId);
    const pending = await db.supportAttachment.findFirstOrThrow({
      where: { status: "PENDING" },
    });
    await deleteSupportConversation(saved.conversationId);
    await runSupportJob(`archive:${pending.id}`);
    expect(fetchMock).toHaveBeenCalledOnce();
  } finally {
    fetchMock.mockRestore();
  }
});
test("storage failures remain visible after deletion and can be retried", async () => {
  const input = uploadInput();
  await caller.feedback.uploadScreenshot(input);
  await caller.feedback.deleteConversation({ confirmation: "DELETE" });
  for (let i = 0; i < 4; i += 1) {
    storage.mockRejectedValueOnce(new Error("Storage down"));
    await runSupportJob(`delete:${input.id}`);
  }
  const operator = harness.authedCaller(OPERATOR);
  expect(await operator.operations.inbox.storageFailures()).toHaveLength(1);
  await operator.operations.inbox.retryStorage({
    jobId: `delete:${input.id}`,
  });
  await runSupportJob(`delete:${input.id}`);
  expect(objects.size).toBe(0);
  expect(await operator.operations.inbox.storageFailures()).toHaveLength(0);
});
