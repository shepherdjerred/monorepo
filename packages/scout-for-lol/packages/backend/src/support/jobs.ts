import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import { SCOUT_WORKFLOW_NAMES, scoutTaskQueues } from "@scout-for-lol/temporal";
import { prisma } from "#src/database/index.ts";
import { isPolicyEnabled } from "#src/configuration/flags.ts";
import configuration from "#src/configuration.ts";
import { currentScoutTemporalSupervisor } from "#src/temporal/runtime.ts";
import type { SupportJob } from "#generated/prisma/client/index.js";
import { sendDM, type DmStatus } from "#src/discord/utils/dm.ts";
import { deliverSupportReply } from "#src/lib/discord/support-reply.ts";
import { getFeedbackUrl } from "#src/discord/utils/feedback.ts";
import {
  archiveScreenshot,
  deleteScreenshotObject,
} from "#src/support/screenshots.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("support-jobs");
// Notification ownership is explicit, not inferred from the operator allowlist.
export const SUPPORT_NOTIFICATION_RECIPIENT =
  DiscordAccountIdSchema.parse("160509172704739328");

/** A failed prompt start never rolls back accepted intake; the Schedule recovers it. */
export async function wakeSupportJobs(): Promise<void> {
  const supervisor = currentScoutTemporalSupervisor();
  if (supervisor === undefined) return;
  try {
    const stage = configuration.temporalNamespace;
    await supervisor
      .client()
      .workflow.start(SCOUT_WORKFLOW_NAMES.backgroundJob, {
        workflowId: `scout-${stage}-support-wake-${crypto.randomUUID()}`,
        taskQueue: scoutTaskQueues(stage).workflow,
        args: [{ stage, kind: "support-inbox" }],
      });
  } catch {
    logger.warn("Support work remains queued for scheduled recovery");
  }
}

async function supportJobEnabled(job: SupportJob): Promise<boolean> {
  return (
    job.kind === "ARCHIVE" ||
    job.kind === "DELETE_OBJECT" ||
    job.kind === "ACKNOWLEDGEMENT" ||
    (await isPolicyEnabled("scout_support_conversations_enabled"))
  );
}

async function supportNotificationText(
  job: SupportJob,
  conversationId: string,
): Promise<string | null> {
  if (job.kind === "ALERT") {
    const inboxUrl = new URL(getFeedbackUrl());
    inboxUrl.pathname = "/app/operations/inbox";
    inboxUrl.searchParams.set("conversation", conversationId);
    return `New private Scout support message. Read and reply in Operations:\n${inboxUrl.toString()}\nThis is an automatic notification; reply using the inbox.`;
  }
  if (job.kind === "ACKNOWLEDGEMENT") {
    const images = await prisma.supportAttachment.count({
      where: { conversationId, status: { in: ["PENDING", "FAILED"] } },
    });
    const screenshotNote =
      images > 0
        ? " Check screenshot status there and resend if archival fails."
        : "";
    return `Thanks — your message is saved in Scout's private support inbox. This is an automatic receipt, not an AI answer. A person may reply here; replies are always available at ${getFeedbackUrl()}.${screenshotNote} You can send more details in this DM.`;
  }
  if (job.replyId === null)
    throw new Error("Support reply job has no reply reference");
  const reply = await prisma.feedbackReply.findUnique({
    where: { id: job.replyId },
  });
  if (reply === null) return null;
  await prisma.feedbackReply.update({
    where: { id: reply.id },
    data: { status: "SENDING" },
  });
  return reply.body.length <= 1600
    ? `Scout team replied:\n\n${reply.body}\n\nView your conversation: ${getFeedbackUrl()}`
    : `Scout team replied. Read the full reply in your private conversation: ${getFeedbackUrl()}`;
}

async function recordSupportDelivery(
  job: SupportJob,
  outcome: DmStatus,
): Promise<void> {
  const status =
    outcome === "sent"
      ? "SENT"
      : outcome === "dm_disabled"
        ? "BLOCKED"
        : "UNKNOWN";
  await prisma.supportJob.update({
    where: { id: job.id },
    data: {
      status,
      errorCode:
        status === "SENT"
          ? null
          : status === "BLOCKED"
            ? "dm-disabled"
            : "delivery-unconfirmed",
    },
  });
  if (job.replyId !== null)
    await prisma.feedbackReply.updateMany({
      where: { id: job.replyId },
      data: {
        status:
          outcome === "sent"
            ? "SENT"
            : outcome === "dm_disabled"
              ? "DM_DISABLED"
              : "FAILED",
        completedAt: new Date(),
      },
    });
}

async function deliverSupportNotification(job: SupportJob): Promise<void> {
  // Re-read after claiming: a queued notification cannot outlive a deleted or muted conversation.
  const conversation = await prisma.supportConversation.findUnique({
    where: { id: job.conversationId ?? "" },
  });
  if (conversation === null || conversation.muted) {
    await prisma.supportJob.update({
      where: { id: job.id },
      data: { status: "SKIPPED" },
    });
    return;
  }
  const message = await supportNotificationText(job, conversation.id);
  if (message === null) {
    await prisma.supportJob.update({
      where: { id: job.id },
      data: { status: "SKIPPED" },
    });
    return;
  }
  const outcome = await sendDM({
    delivery: deliverSupportReply,
    userId:
      job.kind === "ALERT"
        ? SUPPORT_NOTIFICATION_RECIPIENT
        : DiscordAccountIdSchema.parse(conversation.discordId),
    message,
    kind:
      job.kind === "REPLY"
        ? "support_reply"
        : job.kind === "ALERT"
          ? "support_notification"
          : "support_acknowledgement",
    suppressMentions: true,
  });
  await recordSupportDelivery(job, outcome);
}

async function executeSupportJob(job: SupportJob): Promise<void> {
  switch (job.kind) {
    case "DELETE_OBJECT":
      if (job.objectKey === null) throw new Error("Object deletion has no key");
      await deleteScreenshotObject(job.objectKey);
      break;
    case "ARCHIVE":
      if (job.attachmentId === null) {
        await prisma.supportJob.update({
          where: { id: job.id },
          data: { status: "SKIPPED" },
        });
        return;
      }
      await archiveScreenshot(job.attachmentId);
      break;
    case "ALERT":
    case "ACKNOWLEDGEMENT":
    case "REPLY":
      await deliverSupportNotification(job);
      return;
  }
  await prisma.supportJob.update({
    where: { id: job.id },
    data: { status: "SENT" },
  });
}

async function recordSupportFailure(job: SupportJob): Promise<void> {
  const repeatable = job.kind === "ARCHIVE" || job.kind === "DELETE_OBJECT";
  const terminal = !repeatable || job.attempts >= 3;
  // Uncertain Discord delivery is not repeatable. Object puts/deletes use stable keys.
  await prisma.supportJob.update({
    where: { id: job.id },
    data: {
      status: repeatable ? (terminal ? "FAILED" : "QUEUED") : "UNKNOWN",
      errorCode: repeatable ? "storage-unavailable" : "delivery-unconfirmed",
    },
  });
  if (terminal && job.kind === "ARCHIVE" && job.attachmentId !== null) {
    await prisma.supportAttachment.updateMany({
      where: { id: job.attachmentId },
      data: { status: "FAILED" },
    });
  }
  logger.warn("Support job needs recovery", { jobId: job.id, kind: job.kind });
}

export async function runSupportJob(id: string): Promise<void> {
  const job = await prisma.supportJob.findUnique({ where: { id } });
  if (job?.status !== "QUEUED" || !(await supportJobEnabled(job))) return;
  if (job.kind !== "DELETE_OBJECT" && job.conversationId === null) {
    await prisma.supportJob.updateMany({
      where: { id, status: "QUEUED" },
      data: { status: "SKIPPED" },
    });
    return;
  }
  const claim = await prisma.supportJob.updateMany({
    where: { id, status: "QUEUED" },
    data: { status: "SENDING", attempts: { increment: 1 }, errorCode: null },
  });
  if (claim.count === 0) return;
  try {
    await executeSupportJob(job);
  } catch {
    await recordSupportFailure(job);
  }
}

export async function drainSupportJobs(): Promise<void> {
  const stale = new Date(Date.now() - 5 * 60_000);
  // A crash after reserving a Discord send never causes another send.
  await prisma.supportJob.updateMany({
    where: {
      status: "SENDING",
      updatedAt: { lt: stale },
      kind: { notIn: ["ARCHIVE", "DELETE_OBJECT"] },
    },
    data: { status: "UNKNOWN", errorCode: "delivery-unconfirmed" },
  });
  await prisma.supportJob.updateMany({
    where: {
      status: "SENDING",
      updatedAt: { lt: stale },
      kind: { in: ["ARCHIVE", "DELETE_OBJECT"] },
    },
    data: { status: "QUEUED" },
  });
  const orphans = await prisma.supportAttachment.findMany({
    where: {
      feedbackId: null,
      createdAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) },
    },
    take: 25,
  });
  for (const file of orphans)
    await prisma.$transaction(async (tx) => {
      const { lockSupportSender } =
        await import("#src/support/conversations.ts");
      const conversation = await tx.supportConversation.findUnique({
        where: { id: file.conversationId },
      });
      if (conversation === null) return;
      await lockSupportSender(tx, conversation.discordId);
      const current = await tx.supportAttachment.findUnique({
        where: { id: file.id },
      });
      if (current?.feedbackId !== null) return;
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
    });
  const enabled = await isPolicyEnabled("scout_support_conversations_enabled");
  const jobs = await prisma.supportJob.findMany({
    where: {
      status: "QUEUED",
      ...(enabled
        ? {}
        : { kind: { in: ["ARCHIVE", "DELETE_OBJECT", "ACKNOWLEDGEMENT"] } }),
    },
    orderBy: { createdAt: "asc" },
    take: 25,
    select: { id: true },
  });
  for (const job of jobs) await runSupportJob(job.id);
}
