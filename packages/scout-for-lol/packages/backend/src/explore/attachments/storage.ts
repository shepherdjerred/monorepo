import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  EXPLORE_MAX_ATTACHMENTS,
  ExploreAttachmentMediaTypeSchema,
  type DiscordAccountId,
  type ExploreAttachment,
} from "@scout-for-lol/data";
import configuration from "#src/configuration.ts";
import type { ExploreQuestionImage } from "#src/explore/analysis/agent-types.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
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
  input: { mediaType: ExploreAttachment["mediaType"]; bytes: Uint8Array },
): Promise<ExploreAttachment> {
  validateScreenshot(input.bytes, input.mediaType);
  const id = globalThis.crypto.randomUUID();
  const objectKey = exploreAttachmentObjectKey(ownerId, id);
  const sha256 = new Bun.CryptoHasher("sha256")
    .update(input.bytes)
    .digest("hex");
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`explore-attachments:${ownerId}`}))`;
    const [unsent, lastHour] = await Promise.all([
      tx.exploreAttachment.count({ where: { ownerId, questionId: null } }),
      tx.exploreAttachment.count({
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
    await tx.exploreAttachment.create({
      data: {
        id,
        ownerId,
        objectKey,
        mediaType: input.mediaType,
        bytes: input.bytes.length,
        sha256,
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
    await db.exploreAttachment.deleteMany({ where: { id } });
    throw error;
  }
  return { id, mediaType: input.mediaType };
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
  if (input.ids.length === 0) return true;
  const claimed = await db.exploreAttachment.updateMany({
    where: {
      id: { in: [...input.ids] },
      ownerId: input.ownerId,
      questionId: null,
    },
    data: { questionId: input.questionId },
  });
  return claimed.count === new Set(input.ids).size;
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
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return await Promise.all(rows.map((row) => readExploreAttachment(row)));
}
