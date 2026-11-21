import { Temporal } from "@js-temporal/polyfill";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import type { Signal } from "@shepherdjerred/ops-model/snapshot.ts";
import { z } from "zod";

import { providerLabel, quotaMeterName, windowLabel } from "./ai-labels.ts";
import { formatValue } from "#shared/ops-format";

/**
 * Attributes the collector attaches to `quota-window` signals. `windowId` is
 * the stable key; `windowKind` is Brim's name for the kind of window.
 */
const QuotaAttributesSchema = z.object({
  provider: z.string().min(1),
  windowId: z.string().min(1),
  windowKind: z.string().min(1),
  usedRatio: z.number().min(0),
  resetsAt: z.iso.datetime({ offset: true }).optional(),
});

export type QuotaRow = {
  /** The signal's id. */
  readonly id: string;
  readonly windowId: string;
  readonly windowKind: string;
  readonly label: string;
  readonly meterName: string;
  /** Another window of the same provider has the same label. */
  readonly ambiguous: boolean;
  /** The collector's verdict; the page never derives its own from the ratio. */
  readonly severity: Severity;
  readonly usedRatio: number;
  readonly resetsAt: string | undefined;
  /** The window reset after this reading, so the reading is the last one. */
  readonly reset: boolean;
};

export type QuotaGroup = {
  readonly provider: string;
  readonly label: string;
  readonly rows: readonly QuotaRow[];
};

export type QuotaTableModel = {
  /** One group per provider, by display name; rows by window id. */
  readonly groups: readonly QuotaGroup[];
  /** Signals whose attributes the collector sent incomplete. */
  readonly invalid: readonly Signal[];
};

/**
 * Whether a window's reset time had passed when the snapshot was taken. The
 * usage is then the last reading before the reset, not the window's state.
 */
export function hasReset(
  resetsAt: string | undefined,
  generatedAt: string,
): boolean {
  return (
    resetsAt !== undefined &&
    Temporal.Instant.compare(
      Temporal.Instant.from(resetsAt),
      Temporal.Instant.from(generatedAt),
    ) <= 0
  );
}

/** The usage as text: the percentage, or the last one before a reset. */
export function usedText(row: Pick<QuotaRow, "usedRatio" | "reset">): string {
  const percent = formatValue(row.usedRatio, "ratio");
  return row.reset ? `reset · was ${percent}` : percent;
}

export function resetsText(
  row: Pick<QuotaRow, "resetsAt" | "reset">,
  now: Temporal.Instant,
): string {
  if (row.reset) return "awaiting new reading";
  if (row.resetsAt === undefined) return "reset time unknown";
  const hours = Temporal.Instant.from(row.resetsAt)
    .since(now)
    .total({ unit: "hours" });
  if (hours <= 0) return "resetting now";
  if (hours < 1)
    return `resets in ${String(Math.max(1, Math.round(hours * 60)))}m`;
  return hours < 48
    ? `resets in ${String(Math.round(hours))}h`
    : `resets in ${String(Math.round(hours / 24))}d`;
}

function withAmbiguity(rows: readonly QuotaRow[]): QuotaRow[] {
  return rows.map((row) => ({
    ...row,
    ambiguous: rows.some(
      (other) => other.id !== row.id && other.label === row.label,
    ),
  }));
}

/** The quota-window signals as the table lays them out. */
export function quotaTable(
  signals: readonly Signal[],
  generatedAt: string,
): QuotaTableModel {
  const invalid: Signal[] = [];
  const byProvider = new Map<string, QuotaRow[]>();
  for (const signal of signals) {
    const parsed = QuotaAttributesSchema.safeParse(signal.attributes);
    if (!parsed.success) {
      invalid.push(signal);
      continue;
    }
    const { provider, windowId, windowKind, usedRatio, resetsAt } = parsed.data;
    const name = { provider, windowId, windowKind };
    const rows = byProvider.get(provider) ?? [];
    rows.push({
      id: signal.id,
      windowId,
      windowKind,
      label: windowLabel(name),
      meterName: quotaMeterName(name),
      ambiguous: false,
      severity: signal.severity,
      usedRatio,
      resetsAt,
      reset: hasReset(resetsAt, generatedAt),
    });
    byProvider.set(provider, rows);
  }
  const groups = [...byProvider]
    .map(([provider, rows]) => ({
      provider,
      label: providerLabel(provider),
      rows: withAmbiguity(
        rows.toSorted((left, right) =>
          left.windowId.localeCompare(right.windowId, "en"),
        ),
      ),
    }))
    .toSorted((left, right) => left.label.localeCompare(right.label, "en"));
  return {
    groups,
    invalid: invalid.toSorted((left, right) =>
      left.id.localeCompare(right.id, "en"),
    ),
  };
}
