import { createHash } from "node:crypto";
import { ReportRunIdSchema } from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { splitMessageIntoChunks } from "#src/discord/utils/message.ts";
import type { ScheduledReportDispatch } from "#src/reports/schedule/scheduler.ts";

export class ReportDeliveryUnknownError extends Error {
  constructor(runId: number, chunkIndex: number) {
    super(
      `Report run ${runId.toString()} chunk ${chunkIndex.toString()} needs an operator to resolve its unknown Discord delivery`,
    );
  }
}

export function reportAttachmentDigest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Freeze the entire occurrence before sending any chunk. Legacy claims are
 * adopted, never re-executed. An unfinished claim may have reached Discord. */
export async function freezeReportDelivery(
  dispatch: ScheduledReportDispatch,
  database: ExtendedPrismaClient = prisma,
) {
  const reportRunId = ReportRunIdSchema.parse(dispatch.result.runId);
  return await database.$transaction(async (tx) => {
    // Serialize initialisation for this run, including adoption of old claims.
    await tx.$queryRaw`SELECT id FROM "ReportRun" WHERE id = ${reportRunId} FOR UPDATE`;
    const existing = await tx.reportDeliveryChunk.findMany({
      where: { reportRunId },
      orderBy: { chunkIndex: "asc" },
    });
    if (existing.length > 0) {
      if (
        existing.some(
          (row) =>
            row.channelId !== dispatch.report.channelId ||
            row.serverId !== dispatch.report.serverId,
        )
      ) {
        throw new Error(
          "A report delivery cannot change its frozen destination",
        );
      }
      return existing;
    }
    const run = await tx.reportRun.findUniqueOrThrow({
      where: { id: reportRunId },
    });
    const image = dispatch.result.output.image;
    if (image !== null && run.imageS3Key === null) {
      throw new Error(
        "A report attachment must be archived before its delivery is frozen",
      );
    }
    const chunks = splitMessageIntoChunks(dispatch.result.output.content);
    const claims = await tx.scoutEffectClaim.findMany({
      where: {
        key: {
          in: chunks.map(
            (_, index) =>
              `report-discord:${reportRunId.toString()}:${index.toString()}`,
          ),
        },
      },
    });
    await tx.reportDeliveryChunk.createMany({
      data: chunks.map((content, chunkIndex) => {
        const claim = claims.find(
          (row) =>
            row.key ===
            `report-discord:${reportRunId.toString()}:${chunkIndex.toString()}`,
        );
        const state =
          claim?.state === "COMPLETED" || run.deliveryState === "DELIVERED"
            ? "DELIVERED"
            : claim === undefined
              ? "PENDING"
              : "UNKNOWN";
        return {
          reportRunId,
          channelId: dispatch.report.channelId,
          serverId: dispatch.report.serverId,
          chunkIndex,
          content,
          nonce: crypto.randomUUID().replaceAll("-", "").slice(0, 24),
          state,
          messageId: claim?.resultId ?? null,
          deliveredAt:
            state === "DELIVERED"
              ? (claim?.completedAt ?? run.deliveredAt)
              : null,
          lastError:
            state === "UNKNOWN"
              ? "Adopted an unfinished legacy send claim; delivery may have reached Discord"
              : null,
          attachmentKey:
            chunkIndex === 0 && image !== null ? run.imageS3Key : null,
          attachmentName:
            chunkIndex === 0 && image !== null ? image.filename : null,
          attachmentDigest:
            chunkIndex === 0 && image !== null
              ? reportAttachmentDigest(image.data)
              : null,
        };
      }),
    });
    return await tx.reportDeliveryChunk.findMany({
      where: { reportRunId },
      orderBy: { chunkIndex: "asc" },
    });
  });
}

/** The callback may perform exactly one send. Its successful result is durable
 * before a later chunk starts. A crashed or ambiguous attempt is never retried. */
export async function deliverReportChunk(
  chunk: Awaited<ReturnType<typeof freezeReportDelivery>>[number],
  send: () => Promise<{ id: string }>,
  database: ExtendedPrismaClient = prisma,
): Promise<void> {
  const key = {
    reportRunId: chunk.reportRunId,
    channelId: chunk.channelId,
    chunkIndex: chunk.chunkIndex,
  };
  const claimed = await database.reportDeliveryChunk.updateMany({
    where: { ...key, state: "PENDING", nonce: chunk.nonce },
    data: { state: "SENDING", sendStartedAt: new Date(), lastError: null },
  });
  if (claimed.count === 0) {
    const current = await database.reportDeliveryChunk.findUniqueOrThrow({
      where: { reportRunId_channelId_chunkIndex: key },
    });
    if (current.state === "DELIVERED") return;
    // A second observer cannot safely distinguish a live sender from a crash.
    // Leave SENDING intact so its original sender can still checkpoint.
    throw new ReportDeliveryUnknownError(chunk.reportRunId, chunk.chunkIndex);
  }
  try {
    const sent = await send();
    const completed = await database.reportDeliveryChunk.updateMany({
      where: { ...key, nonce: chunk.nonce, state: "SENDING" },
      data: {
        state: "DELIVERED",
        messageId: sent.id,
        deliveredAt: new Date(),
        lastError: null,
      },
    });
    if (completed.count !== 1)
      throw new Error(
        "Report delivery changed while its sender was checkpointing",
      );
  } catch (error) {
    await database.reportDeliveryChunk.updateMany({
      where: { ...key, nonce: chunk.nonce, state: "SENDING" },
      data: {
        state: "UNKNOWN",
        lastError: error instanceof Error ? error.message : String(error),
      },
    });
    throw new ReportDeliveryUnknownError(chunk.reportRunId, chunk.chunkIndex);
  }
}
