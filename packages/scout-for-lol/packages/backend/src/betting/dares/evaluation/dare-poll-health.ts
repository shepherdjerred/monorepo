import { DarePollHealthSchema, type DarePollHealth } from "@scout-for-lol/data";
import { z } from "zod";

const POLL_STALE_AFTER_MS = 2 * 60 * 1000;
const StoredPollStatusSchema = z.enum([
  "never",
  "running",
  "healthy",
  "incomplete",
  "failed",
]);

type PollHealthRow = {
  lastSuccessfulPollAt: Date | null;
  pollStartedAt: Date | null;
  pollCompletedAt: Date | null;
  evidenceWatermarkAt: Date | null;
  pollEvidenceComplete: boolean | null;
  pollFailureReason: string | null;
  pollStatus: string;
};

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export function darePollHealth(
  row: PollHealthRow | null,
  now = new Date(),
): DarePollHealth {
  if (row === null) {
    return DarePollHealthSchema.parse({
      status: "never",
      pollStartedAt: null,
      pollCompletedAt: null,
      evidenceWatermarkAt: null,
      lastSuccessfulProcessingAt: null,
      failureReason: null,
      incompleteReasons: ["No post-match poll has completed yet."],
    });
  }
  const storedStatus = StoredPollStatusSchema.parse(row.pollStatus);
  const unfinished =
    row.pollStartedAt !== null &&
    (row.pollCompletedAt === null || row.pollCompletedAt < row.pollStartedAt);
  const stale =
    storedStatus === "healthy" &&
    row.pollCompletedAt !== null &&
    now.getTime() - row.pollCompletedAt.getTime() > POLL_STALE_AFTER_MS;
  const status = unfinished ? "delayed" : stale ? "stale" : storedStatus;
  const incompleteReasons = [
    ...(unfinished ? ["A post-match poll started but has not completed."] : []),
    ...(stale
      ? ["The latest completed poll is more than two cadences old."]
      : []),
    ...(row.pollEvidenceComplete === false
      ? [row.pollFailureReason ?? "Required match evidence is incomplete."]
      : []),
  ];
  return DarePollHealthSchema.parse({
    status: status === "running" ? "delayed" : status,
    pollStartedAt: iso(row.pollStartedAt),
    pollCompletedAt: iso(row.pollCompletedAt),
    evidenceWatermarkAt: iso(row.evidenceWatermarkAt),
    lastSuccessfulProcessingAt: iso(row.lastSuccessfulPollAt),
    failureReason: row.pollFailureReason,
    incompleteReasons,
  });
}
