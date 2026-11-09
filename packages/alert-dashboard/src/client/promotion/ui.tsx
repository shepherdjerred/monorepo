import { Temporal } from "@js-temporal/polyfill";
import { systemClock, toContractDate } from "#shared/time";
import type { PromotionHistoryEntry } from "@shepherdjerred/ops-model/promotion/model.ts";
export const money = (amount: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 3,
  }).format(amount);
export function time(value: string | null) {
  return value === null
    ? "Not recorded"
    : new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(toContractDate(Temporal.Instant.from(value)));
}
export function relative(value: string) {
  const minutes = Math.round(
    (Temporal.Instant.from(value).epochMilliseconds -
      systemClock.now().epochMilliseconds) /
      60_000,
  );
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(
    Math.abs(minutes) < 60
      ? minutes
      : Math.abs(minutes) < 1440
        ? Math.round(minutes / 60)
        : Math.round(minutes / 1440),
    Math.abs(minutes) < 60
      ? "minute"
      : Math.abs(minutes) < 1440
        ? "hour"
        : "day",
  );
}
export function Stamp({ value }: { value: string | null }) {
  return (
    <span className="p-stamp">
      {time(value)}
      {value !== null && <small>{relative(value)}</small>}
    </span>
  );
}
export function Badge({ label }: { label: string }) {
  return (
    <span
      className={`p-badge ${/verified|preview|completed/.test(label) ? "p-good" : /blocked|failed|uncertain|interrupted|Paused|reconciliation/.test(label) ? "p-warn" : ""}`}
    >
      {label}
    </span>
  );
}
export function LinkOut({ url, label }: { url: string | null; label: string }) {
  return url !== null && /^https?:\/\//.test(url) ? (
    <a href={url} target="_blank" rel="noreferrer">
      {label} ↗
    </a>
  ) : null;
}
export function HistoryItem({ entry }: { entry: PromotionHistoryEntry }) {
  return (
    <article className="p-history-item">
      <div className="p-flex">
        <Badge label={entry.status} />
        <span className="p-muted">
          {entry.timeBasis === "attempt"
            ? "Publishing attempt"
            : entry.mode === "unknown"
              ? "Legacy report · mode unknown"
              : entry.mode}
        </span>
        <Stamp value={entry.at} />
      </div>
      <p>{entry.summary}</p>
      <div className="p-flex p-muted">
        {entry.timeBasis === "report-saved" && (
          <span>Report save time; exact execution time unavailable</span>
        )}
        {entry.finishedAt !== null && (
          <span>Finished {time(entry.finishedAt)}</span>
        )}
        <LinkOut url={entry.receiptUrl} label="Receipt" />
        {entry.evidenceId !== null && (
          <a
            href={`/api/v1/promotion/evidence/${entry.evidenceId}`}
            target="_blank"
            rel="noreferrer"
          >
            Captured evidence ↗
          </a>
        )}
        {entry.costUsd !== null && (
          <span>AI estimate {money(entry.costUsd)}</span>
        )}
      </div>
      {entry.cleanup !== null && <p>Reply cleanup: {entry.cleanup}</p>}
    </article>
  );
}
