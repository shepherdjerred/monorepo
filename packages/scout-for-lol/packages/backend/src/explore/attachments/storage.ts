import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  EXPLORE_ATTACHMENT_HOLD_MS,
  EXPLORE_MAX_ATTACHMENTS,
  ExploreAttachmentMediaTypeSchema,
  type DiscordAccountId,
  type ExploreAttachment,
} from "@scout-for-lol/data";
import configuration from "#src/configuration.ts";
import type { ExploreQuestionImage } from "#src/explore/analysis/agent-types.ts";
import { queueExploreAttachmentDeletion } from "#src/explore/attachments/cleanup.ts";
import type { Db, ExtendedPrismaClient } from "#src/database/index.ts";
import { createS3Client } from "#src/storage/s3-client.ts";
import {
  MAX_SCREENSHOT_BYTES,
  readBoundedImageStream,
  validateScreenshot,
} from "#src/support/screenshots.ts";

/**
 * Images people attach to Explore questions.
 *
 * Uploaded before the question is sent, then claimed by the question that
 * names them. They share the private support bucket — the one store for
 * user-provided screenshots, never served from a public route — under an
 * `explore/` prefix, and the same validation: a PNG, JPEG or WebP by its magic
 * bytes, at most 10 MiB.
 */

export const ExploreAttachmentUploadSchema = z.strictObject({
  mediaType: ExploreAttachmentMediaTypeSchema,
  base64: z
    .string()
    .min(4)
    .max(4 * Math.ceil(MAX_SCREENSHOT_BYTES / 3))
    .regex(/^[A-Z0-9+/]+={0,2}$/i),
});

/** Uploads a person may hold before sending a question that uses them. */
const MAX_UNSENT_ATTACHMENTS = 2 * EXPLORE_MAX_ATTACHMENTS;
/** Uploads per person per hour, sent or not. */
const MAX_HOURLY_ATTACHMENTS = 40;

const s3 = createS3Client();

function bucket(): string {
  const value = configuration.supportBucketName;
  if (value === undefined)
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Image storage is not configured.",
    });
  return value;
}

export function exploreAttachmentObjectKey(
  ownerId: DiscordAccountId,
  id: string,
): string {
  return `explore/${ownerId}/${id}`;
}

/**
 * Store one image for `ownerId` and return its reference.
 *
 * The row is written first, under a per-owner lock that keeps the upload
 * limits exact, and removed again if the object write fails. A crash between
 * the two leaves an unsent row whose id no client ever saw; the cleanup sweep
 * collects it.
 */
export async function storeExploreAttachment(
  db: ExtendedPrismaClient,
  ownerId: DiscordAccountId,
  input: {
    mediaType: ExploreAttachment["mediaType"];
    bytes: Uint8Array;
  },
): Promise<ExploreAttachment> {
  validateScreenshot(input.bytes, input.mediaType);
  const id = globalThis.crypto.randomUUID();
  const objectKey = exploreAttachmentObjectKey(ownerId, id);
  const sha256 = new Bun.CryptoHasher("sha256")
    .update(input.bytes)
    .digest("hex");
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`explore-attachments:${ownerId}`}))`;
    // The hourly count reads the upload ledger, not the attachments: deleting
    // a conversation deletes its attachments but must not reset the limit.
    // At the cap, uploads whose hold lapsed were abandoned (a refresh, a
    // closed tab): no composer still shows them, in any tab. Reclaim those
    // before refusing, so they cannot hold the person's slots.
    if (
      (await tx.exploreAttachment.count({
        where: { ownerId, questionId: null },
      })) >= MAX_UNSENT_ATTACHMENTS
    )
      await reclaimAbandonedUploads(tx, ownerId);
    const [unsent, lastHour] = await Promise.all([
      tx.exploreAttachment.count({ where: { ownerId, questionId: null } }),
      tx.exploreAttachmentUpload.count({
        where: {
          ownerId,
          createdAt: { gte: new Date(Date.now() - 3_600_000) },
        },
      }),
    ]);
    if (unsent >= MAX_UNSENT_ATTACHMENTS)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Send or remove the images you already attached first.",
      });
    if (lastHour >= MAX_HOURLY_ATTACHMENTS)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Too many images this hour. Try again later.",
      });
    await tx.exploreAttachmentUpload.create({ data: { ownerId } });
    await tx.exploreAttachment.create({
      data: {
        id,
        ownerId,
        objectKey,
        mediaType: input.mediaType,
        bytes: input.bytes.length,
        sha256,
        heldUntil: new Date(Date.now() + EXPLORE_ATTACHMENT_HOLD_MS),
      },
    });
  });
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: objectKey,
        Body: input.bytes,
        ContentType: input.mediaType,
      }),
      { abortSignal: AbortSignal.timeout(20_000) },
    );
  } catch (error) {
    // A lost reply or a timeout can hide a PUT that succeeded, so the object
    // may exist: queue its deletion rather than forget the only record of it.
    await db.$transaction(async (tx) => {
      await queueExploreAttachmentDeletion(tx, { id, questionId: null });
    });
    throw error;
  }
  return { id, mediaType: input.mediaType };
}

async function reclaimAbandonedUploads(
  tx: Db,
  ownerId: DiscordAccountId,
): Promise<void> {
  const abandoned = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "ExploreAttachment"
    WHERE "ownerId" = ${ownerId} AND "questionId" IS NULL
      AND "heldUntil" < ${new Date()}
    FOR UPDATE SKIP LOCKED`;
  if (abandoned.length > 0)
    await queueExploreAttachmentDeletion(tx, {
      id: { in: abandoned.map((row) => row.id) },
      questionId: null,
    });
}

/**
 * Renew the hold on unsent uploads a composer still shows. Ids that are not
 * the owner's, or already sent or gone, are ignored: the composer learns of
 * those when it sends.
 */
export async function holdExploreAttachments(
  db: ExtendedPrismaClient,
  ownerId: DiscordAccountId,
  ids: readonly string[],
): Promise<void> {
  await db.exploreAttachment.updateMany({
    where: { id: { in: [...ids] }, ownerId, questionId: null },
    data: { heldUntil: new Date(Date.now() + EXPLORE_ATTACHMENT_HOLD_MS) },
  });
}

/** Upload from the web composer: base64 in a tRPC mutation. */
export async function uploadExploreAttachment(
  db: ExtendedPrismaClient,
  ownerId: DiscordAccountId,
  input: z.infer<typeof ExploreAttachmentUploadSchema>,
): Promise<ExploreAttachment> {
  return await storeExploreAttachment(db, ownerId, {
    mediaType: input.mediaType,
    bytes: Buffer.from(input.base64, "base64"),
  });
}

/**
 * Claim uploads for the question that names them.
 *
 * Each must belong to the asker and be unsent. Anything else — a stranger's
 * id, one already sent with another question, one the sweep collected — means
 * the client is out of date, and the question is refused rather than sent
 * without the image the asker meant to show.
 */
export async function claimExploreAttachments(
  db: Pick<ExtendedPrismaClient, "exploreAttachment">,
  input: {
    ids: readonly string[];
    ownerId: DiscordAccountId;
    questionId: string;
  },
): Promise<boolean> {
  // One update per image so each keeps the position the asker gave it; the
  // order reaches the model and the transcript unchanged.
  for (const [position, id] of input.ids.entries()) {
    const claimed = await db.exploreAttachment.updateMany({
      where: { id, ownerId: input.ownerId, questionId: null },
      data: { questionId: input.questionId, position },
    });
    if (claimed.count !== 1) return false;
  }
  return true;
}

export type ExploreAttachmentRow = {
  readonly id: string;
  readonly objectKey: string;
  readonly mediaType: string;
  readonly bytes: number;
  readonly sha256: string;
};

/** The stored bytes, checked against the row that describes them. */
export async function readExploreAttachment(
  row: ExploreAttachmentRow,
): Promise<{ mediaType: ExploreAttachment["mediaType"]; bytes: Uint8Array }> {
  const result = await s3.send(
    new GetObjectCommand({ Bucket: bucket(), Key: row.objectKey }),
    { abortSignal: AbortSignal.timeout(20_000) },
  );
  if (result.Body === undefined)
    throw new Error("Stored Explore attachment has no body");
  const bytes = await readBoundedImageStream(
    result.Body.transformToWebStream(),
    "Stored Explore attachment exceeds size limit",
  );
  const mediaType = ExploreAttachmentMediaTypeSchema.parse(row.mediaType);
  validateScreenshot(bytes, mediaType);
  if (
    bytes.length !== row.bytes ||
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== row.sha256
  )
    throw new Error("Stored Explore attachment integrity mismatch");
  return { mediaType, bytes };
}

/** The verified images a question carries, in the order they were attached. */
export async function loadQuestionImages(
  db: Pick<ExtendedPrismaClient, "exploreAttachment">,
  questionId: string,
): Promise<ExploreQuestionImage[]> {
  const rows = await db.exploreAttachment.findMany({
    where: { questionId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  return await Promise.all(rows.map((row) => readExploreAttachment(row)));
}

/**
 * Drop an upload the asker removed from the composer before sending it.
 * Only their own unsent images; a sent one belongs to its question.
 */
export async function discardExploreAttachment(
  db: ExtendedPrismaClient,
  ownerId: DiscordAccountId,
  id: string,
): Promise<boolean> {
  return await db.$transaction(async (tx) => {
    // Locked first: a question claiming this image at the same moment either
    // waits and then finds it gone, or wins and leaves nothing to discard.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "ExploreAttachment"
      WHERE id = ${id} AND "ownerId" = ${ownerId} AND "questionId" IS NULL
      FOR UPDATE`;
    if (locked.length === 0) return false;
    const removed = await queueExploreAttachmentDeletion(tx, {
      id,
      ownerId,
      questionId: null,
    });
    return removed > 0;
  });
}
