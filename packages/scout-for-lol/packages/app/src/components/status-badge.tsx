import { match } from "ts-pattern";
import type { CompetitionStatus } from "@scout-for-lol/data";
import { Badge, type BadgeProps } from "#src/components/ui/badge.tsx";

/** A report's last-run status as stored on the row (may be absent). */
export type ReportRunStatusValue = "RUNNING" | "SUCCESS" | "FAILED";

function competitionVariant(status: CompetitionStatus): BadgeProps["variant"] {
  return match(status)
    .with("ACTIVE", () => "default" as const)
    .with("DRAFT", () => "secondary" as const)
    .with("ENDED", () => "outline" as const)
    .with("CANCELLED", () => "destructive" as const)
    .exhaustive();
}

export function CompetitionStatusBadge({
  status,
}: {
  status: CompetitionStatus;
}) {
  return <Badge variant={competitionVariant(status)}>{status}</Badge>;
}

function reportRunVariant(status: ReportRunStatusValue): BadgeProps["variant"] {
  return match(status)
    .with("SUCCESS", () => "default" as const)
    .with("RUNNING", () => "secondary" as const)
    .with("FAILED", () => "destructive" as const)
    .exhaustive();
}

/**
 * Renders a report run's status. The value is a free-form string from the DB
 * (`lastRunStatus` / `ReportRun.status`); unknown values fall back to a neutral
 * badge with an em dash rather than throwing.
 */
export function ReportRunStatusBadge({ status }: { status: string | null }) {
  if (status === null) {
    return <Badge variant="outline">—</Badge>;
  }
  if (status === "SUCCESS" || status === "RUNNING" || status === "FAILED") {
    return <Badge variant={reportRunVariant(status)}>{status}</Badge>;
  }
  return <Badge variant="outline">{status}</Badge>;
}
