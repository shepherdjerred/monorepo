import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import configuration from "#src/configuration.ts";
import { createS3Client } from "#src/storage/s3-client.ts";
import { prisma, type Db } from "#src/database/index.ts";
import { ensureConversation } from "#src/support/conversations.ts";
import {
  lockSupportSender,
  MAX_SUPPORT_UPLOADS_PER_MINUTE,
  readSupportSenderThrottle,
  writeSupportSenderThrottle,
} from "#src/support/sender-throttle.ts";

export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
export const ScreenshotTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
export const ScreenshotUploadSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(255),
  contentType: ScreenshotTypeSchema,
  base64: z
    .string()
    .min(4)
    .max(4 * Math.ceil(MAX_SCREENSHOT_BYTES / 3))
    .regex(/^[A-Z0-9+/]+={0,2}$/i),
});
export const DiscordScreenshotSchema = z.object({
  name: z.string().min(1).max(255),
  contentType: ScreenshotTypeSchema,
  size: z.number().int().positive().max(MAX_SCREENSHOT_BYTES),
  url: z.url().refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      ["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname) &&
      url.pathname.startsWith("/attachments/")
    );
  }, "Expected a Discord attachment URL"),
});

const s3 = createS3Client();

export async function queueScreenshotDeletion(
  tx: Db,
  file: { id: string; objectKey: string },
): Promise<void> {
  await tx.supportJob.upsert({
    where: { id: `delete:${file.id}` },
    create: {
      id: `delete:${file.id}`,
      kind: "DELETE_OBJECT",
      objectKey: file.objectKey,
    },
    update: {},
  });
  await tx.supportAttachment.delete({ where: { id: file.id } });
}

function bucket(): string {
  const value = configuration.supportBucketName;
  if (value === undefined)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Screenshot storage is not configured.",
    });
  return value;
}

export function validateScreenshot(
  bytes: Uint8Array,
  contentType: string,
): void {
  const type = ScreenshotTypeSchema.parse(contentType);
  const prefix = [...bytes.slice(0, 12)];
  const valid =
    type === "image/png"
      ? prefix.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10"
      : type === "image/jpeg"
        ? bytes[0] === 255 &&
          bytes[1] === 216 &&
          bytes.at(-2) === 255 &&
          bytes.at(-1) === 217
        : Buffer.from(bytes.slice(0, 4)).toString() === "RIFF" &&
          Buffer.from(bytes.slice(8, 12)).toString() === "WEBP";
  if (!valid || bytes.length > MAX_SCREENSHOT_BYTES || bytes.length < 12) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Choose a valid PNG, JPEG, or WebP screenshot of 10 MiB or less.",
    });
  }
}

export async function uploadScreenshot(
  discordId: string,
  input: z.infer<typeof ScreenshotUploadSchema>,
) {
  const bytes = Buffer.from(input.base64, "base64");
  validateScreenshot(bytes, input.contentType);
  const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  // Reserve the key before I/O. A failed final DB commit must not orphan an
  // untracked private object; pending uploads remain retryable and collectible.
  const reserved = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
    await lockSupportSender(tx, discordId);
    const conversation = await ensureConversation(tx, discordId);
    if (conversation.muted)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "This conversation is muted.",
      });
    const existing = await tx.supportAttachment.findUnique({
      where: { id: input.id },
    });
    if (existing !== null) {
      if (
        existing.conversationId !== conversation.id ||
        existing.name !== input.name ||
        existing.size !== bytes.length ||
        existing.contentType !== input.contentType ||
        existing.digest !== digest
      ) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This upload request has already been used.",
        });
      }
      return existing;
    }
    if (
      (await tx.supportJob.findUnique({
        where: { id: `delete:${input.id}` },
      })) !== null
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "This upload was deleted. Choose the screenshot again.",
      });
    const cutoff = new Date(Date.now() - 60_000);
    const throttle = await readSupportSenderThrottle(tx, discordId);
    const recentUploads = throttle.uploadAt.filter(
      (createdAt) => createdAt >= cutoff,
    );
    if (recentUploads.length >= MAX_SUPPORT_UPLOADS_PER_MINUTE)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Please wait a minute before uploading more screenshots.",
      });
    const pending = await tx.supportAttachment.count({
      where: { conversationId: conversation.id, feedbackId: null },
    });
    if (pending >= 5)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message:
          "Attach or remove your existing screenshots before uploading more.",
      });
    const now = new Date();
    const attachment = await tx.supportAttachment.create({
      data: {
        id: input.id,
        conversationId: conversation.id,
        name: input.name,
        contentType: input.contentType,
        size: bytes.length,
        objectKey: `${conversation.id}/${input.id}`,
        digest,
      },
    });
    await writeSupportSenderThrottle(tx, discordId, {
      ...throttle,
      uploadAt: [...recentUploads, now],
    });
    return attachment;
  });
  if (reserved.status === "STORED") return { id: reserved.id };
  const startedAt = Date.now();
  return await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
      await lockSupportSender(tx, discordId);
      const file = await tx.supportAttachment.findUnique({
        where: { id: reserved.id },
      });
      if (file === null)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "This upload was deleted. Choose the screenshot again.",
        });
      const remaining = Math.min(20_000, 30_000 - (Date.now() - startedAt));
      if (remaining <= 0)
        throw new TRPCError({
          code: "TIMEOUT",
          message: "Upload timed out. Please retry.",
        });
      const objectKey = file.objectKey;
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket(),
          Key: objectKey,
          Body: bytes,
          ContentType: input.contentType,
        }),
        { abortSignal: AbortSignal.timeout(remaining) },
      );
      await tx.supportAttachment.update({
        where: { id: input.id },
        data: { status: "STORED" },
      });
      return { id: input.id };
    },
    { timeout: 35_000 },
  );
}

async function readDiscordImage(
  url: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  DiscordScreenshotSchema.shape.url.parse(url);
  const response = await fetch(url, { redirect: "error", signal });
  if (!response.ok || response.body === null)
    throw new Error("Screenshot download unavailable");
  return await readBoundedImageStream(
    response.body,
    "Screenshot exceeds size limit",
  );
}

async function readBoundedImageStream(
  stream: ReadableStream<unknown>,
  sizeError: string,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const bytes = z.instanceof(Uint8Array).parse(chunk.value);
      size += bytes.length;
      if (size > MAX_SCREENSHOT_BYTES) throw new Error(sizeError);
      chunks.push(bytes);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

/** The sender lock serializes archive puts with deletion, so no late put resurrects a file. */
export async function archiveScreenshot(id: string): Promise<void> {
  const startedAt = Date.now();
  await prisma.$transaction(
    async (tx) => {
      const initial = await tx.supportAttachment.findUnique({
        where: { id },
        include: { conversation: true },
      });
      if (initial === null) return;
      await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
      await lockSupportSender(tx, initial.conversation.discordId);
      const file = await tx.supportAttachment.findUnique({ where: { id } });
      if (file === null || file.status === "STORED") return;
      if (file.sourceUrl === null)
        throw new Error("Pending Discord screenshot has no source URL");
      const remaining = Math.min(20_000, 30_000 - (Date.now() - startedAt));
      if (remaining <= 0)
        throw new Error("Screenshot archive deadline elapsed");
      const signal = AbortSignal.timeout(remaining);
      const bytes = await readDiscordImage(file.sourceUrl, signal);
      validateScreenshot(bytes, file.contentType);
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket(),
          Key: file.objectKey,
          Body: bytes,
          ContentType: file.contentType,
        }),
        { abortSignal: signal },
      );
      await tx.supportAttachment.update({
        where: { id },
        data: {
          status: "STORED",
          sourceUrl: null,
          size: bytes.length,
          digest: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
        },
      });
    },
    { timeout: 35_000 },
  );
}

export async function readScreenshot(objectKey: string): Promise<Uint8Array> {
  const result = await s3.send(
    new GetObjectCommand({ Bucket: bucket(), Key: objectKey }),
    { abortSignal: AbortSignal.timeout(20_000) },
  );
  if (result.Body === undefined)
    throw new Error("Stored screenshot has no body");
  return await readBoundedImageStream(
    result.Body.transformToWebStream(),
    "Stored screenshot exceeds size limit",
  );
}
export async function deleteScreenshotObject(objectKey: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket(), Key: objectKey }), {
    abortSignal: AbortSignal.timeout(20_000),
  });
}
