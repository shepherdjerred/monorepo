import { Temporal } from "@js-temporal/polyfill";
import type { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import type { z } from "zod";

import { ChangeViewSchema, type ChangeView } from "#shared/ops-schema";
import type { SeveritySchema } from "#shared/schema";
import { epochNanosecondsToInstantText } from "#shared/time";

/** Where alert-derived timeline entries link to. */
export const ALERTS_PUBLIC_URL = "https://alerts.tailnet-1a49.ts.net";

/** One opening or resolution from the alert ledger. */
export type AlertLedgerChange = {
  eventId: string;
  occurrenceId: string;
  type: "opened" | "resolved";
  occurredAtNs: bigint;
  alertname: string;
  namespace: string | null;
  severity: z.infer<typeof SeveritySchema>;
  summary: string;
};

const ALERT_SEVERITY: Record<z.infer<typeof SeveritySchema>, Severity> = {
  critical: "error",
  warning: "warning",
  info: "info",
  unknown: "unknown",
};

/**
 * Alert openings and resolutions become `alert-open` / `alert-resolve`
 * timeline entries at read time, so the ledger stays the single record of
 * alert history and the collector never re-reports it.
 */
export function alertChangeView(
  change: AlertLedgerChange,
  services: ServiceIndex,
): ChangeView {
  const service =
    change.namespace === null
      ? undefined
      : services.byNamespace(change.namespace)?.id;
  const opened = change.type === "opened";
  return ChangeViewSchema.parse({
    id: `alerts:${change.eventId}`,
    source: "alerts",
    externalId: change.eventId,
    kind: opened ? "alert-open" : "alert-resolve",
    ...(service === undefined ? {} : { service }),
    title: `${opened ? "Opened" : "Resolved"}: ${change.summary} (${change.alertname})`,
    occurredAt: epochNanosecondsToInstantText(change.occurredAtNs),
    severity: opened ? ALERT_SEVERITY[change.severity] : "ok",
    url: `${ALERTS_PUBLIC_URL}/alerts/${change.occurrenceId}`,
  });
}

/** Newest first; ties broken by id so pagination is stable. */
export function mergeChanges(
  groups: readonly (readonly ChangeView[])[],
  limit: number,
): ChangeView[] {
  return groups
    .flat()
    .toSorted(
      (left, right) =>
        Temporal.Instant.compare(
          Temporal.Instant.from(right.occurredAt),
          Temporal.Instant.from(left.occurredAt),
        ) || left.id.localeCompare(right.id),
    )
    .slice(0, limit);
}
