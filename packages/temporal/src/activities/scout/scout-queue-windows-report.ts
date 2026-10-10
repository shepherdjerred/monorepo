import { z } from "zod/v4";

/**
 * The report contract between Scout's `update-queue-windows.ts` CLI and the
 * queue-windows activity.
 *
 * Split out so the pure PR-body builder can share the type without importing
 * the activity, which drags in S3, GitHub, and Temporal.
 */

/** The match lake the watcher observes. */
export const BUCKET = "scout-prod";

const ReportEditSchema = z.object({
  queue: z.string(),
  kind: z.enum(["open", "reopen", "close"]),
  date: z.string(),
  message: z.string(),
});

const ReportWarningSchema = z.object({
  kind: z.string(),
  message: z.string(),
  // The drift engine emits these three; the schema used to drop them, so the
  // volume behind a warning was discarded here — as was `unknownQueueIds`,
  // which was parsed and then never read by anything.
  queue: z.string().optional(),
  queueId: z.string().optional(),
  total: z.number().optional(),
});

const ReportPatchNotesSchema = z.union([
  z.object({
    titles: z.array(z.object({ title: z.string(), url: z.string() })),
  }),
  z.object({ error: z.string() }),
]);

export const QueueWindowsReportSchema = z.object({
  edits: z.array(ReportEditSchema),
  warnings: z.array(ReportWarningSchema),
  unknownQueueIds: z.array(
    z.object({ queueId: z.string(), total: z.number() }),
  ),
  patchNotes: ReportPatchNotesSchema,
});

export type QueueWindowsReport = z.infer<typeof QueueWindowsReportSchema>;

/** Observation totals and ages belong in the message, not the identity. */
export function queueWarningFinding(
  warning: QueueWindowsReport["warnings"][number],
): { id?: string; summary: string } {
  const known = [
    "unknown-queue-id",
    "no-volume-baseline",
    "window-too-young",
    "sparse-no-close",
  ].includes(warning.kind);
  if (known && warning.queue === undefined && warning.queueId === undefined) {
    throw new Error(`Queue warning ${warning.kind} has no queue identity`);
  }
  return {
    ...(known
      ? {
          id: `queue-warning:${JSON.stringify([warning.kind, warning.queue ?? null, warning.queueId ?? null])}`,
        }
      : {}),
    summary: `${warning.kind}: ${warning.message}`,
  };
}
