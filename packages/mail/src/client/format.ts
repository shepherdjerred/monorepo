import type { Figure, Severity } from "@shepherdjerred/console-ui";
import {
  formatMailClientLabel,
  MESSAGE_STATUSES,
  type AdminClientStats,
  type AdminMessageDetail,
  type AdminOverviewResponse,
  type AttemptOutcome,
  type MessageStatus,
} from "@shepherdjerred/mail/shared/contract.ts";
import { z } from "zod";

export const PACIFIC_TIME_ZONE = "America/Los_Angeles";

export const STATUS_FILTERS = ["active", ...MESSAGE_STATUSES] as const;
export const StatusFilterSchema = z.enum(STATUS_FILTERS);
export type StatusFilter = z.infer<typeof StatusFilterSchema>;

export const DETAIL_TABS = ["plain", "html", "diagnostics"] as const;
export const DetailTabSchema = z.enum(DETAIL_TABS);
export type DetailTab = z.infer<typeof DetailTabSchema>;

export type OutboxFilter = {
  readonly status?: StatusFilter;
  readonly client?: string;
  readonly q?: string;
};

const STATUS_FILTER_LABELS: Readonly<Record<StatusFilter, string>> = {
  active: "Queued & retrying",
  queued: "Queued",
  sending: "Sending",
  retrying: "Retrying",
  sent: "Sent",
  failed: "Failed",
};

const MESSAGE_STATUS_LABELS: Readonly<Record<MessageStatus, string>> = {
  queued: "Queued",
  sending: "Sending",
  retrying: "Retrying",
  sent: "Sent",
  failed: "Failed",
};

const MESSAGE_STATUS_SEVERITIES: Readonly<Record<MessageStatus, Severity>> = {
  sent: "ok",
  queued: "info",
  sending: "info",
  retrying: "warning",
  failed: "error",
};

const ATTEMPT_OUTCOME_LABELS: Readonly<Record<AttemptOutcome, string>> = {
  sent: "Sent",
  transient_error: "Transient error",
  permanent_error: "Permanent error",
};

const ATTEMPT_OUTCOME_SEVERITIES: Readonly<Record<AttemptOutcome, Severity>> = {
  sent: "ok",
  transient_error: "warning",
  permanent_error: "error",
};

const shortFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC_TIME_ZONE,
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const fullFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC_TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const dateOnlyFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC_TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
});

export function parseOutboxFilter(params: URLSearchParams): OutboxFilter {
  const statusParsed = StatusFilterSchema.safeParse(params.get("status"));
  const clientRaw = params.get("client")?.trim();
  const queryRaw = params.get("q")?.trim();
  return {
    ...(statusParsed.success ? { status: statusParsed.data } : {}),
    ...(clientRaw !== undefined && clientRaw.length > 0
      ? { client: clientRaw }
      : {}),
    ...(queryRaw !== undefined && queryRaw.length > 0 ? { q: queryRaw } : {}),
  };
}

export function buildOutboxSearchParams(filter: OutboxFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.status !== undefined) {
    params.set("status", filter.status);
  }
  if (filter.client !== undefined && filter.client.length > 0) {
    params.set("client", filter.client);
  }
  if (filter.q !== undefined && filter.q.trim().length > 0) {
    params.set("q", filter.q.trim());
  }
  return params;
}

export function hasActiveOutboxFilter(filter: OutboxFilter): boolean {
  return (
    filter.status !== undefined ||
    filter.client !== undefined ||
    filter.q !== undefined
  );
}

export function outboxFilterHeading(filter: OutboxFilter): string {
  if (filter.client !== undefined && filter.status !== undefined) {
    return `${formatMailClientLabel(filter.client)} · ${STATUS_FILTER_LABELS[filter.status]}`;
  }
  if (filter.client !== undefined) {
    return formatMailClientLabel(filter.client);
  }
  return filter.status === undefined
    ? "Outbox"
    : STATUS_FILTER_LABELS[filter.status];
}

export function outboxDocumentTitle(filter: OutboxFilter): string {
  return `${outboxFilterHeading(filter)} | Mail`;
}

export function detailDocumentTitle(subject: string | undefined): string {
  const clean = subject?.trim();
  return clean === undefined || clean.length === 0
    ? "Message | Mail"
    : `${clean} | Mail`;
}

export function syncDocumentTitle(title: string): void {
  if (typeof document !== "undefined") {
    document.title = title;
  }
}

export function messageStatusSeverity(status: MessageStatus): Severity {
  return MESSAGE_STATUS_SEVERITIES[status];
}

export function messageStatusLabel(status: MessageStatus): string {
  return MESSAGE_STATUS_LABELS[status];
}

export function attemptOutcomeSeverity(outcome: AttemptOutcome): Severity {
  return ATTEMPT_OUTCOME_SEVERITIES[outcome];
}

export function attemptOutcomeLabel(outcome: AttemptOutcome): string {
  return ATTEMPT_OUTCOME_LABELS[outcome];
}

function partMap(
  formatter: Intl.DateTimeFormat,
  date: Date,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    out[part.type] = part.value;
  }
  return out;
}

export function formatPacificTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const p = partMap(shortFormatter, date);
  return `${p["month"] ?? ""} ${p["day"] ?? ""}, ${p["hour"] ?? "00"}:${p["minute"] ?? "00"} PT`;
}

export function formatPacificFull(iso: string | null): string {
  if (iso === null) {
    return "—";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const p = partMap(fullFormatter, date);
  return `${p["month"] ?? ""} ${p["day"] ?? ""}, ${p["year"] ?? ""}, ${p["hour"] ?? "00"}:${p["minute"] ?? "00"}:${p["second"] ?? "00"} PT`;
}

export function formatPacificDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateOnlyFormatter.format(date);
}

export function formatRelayMeta(relay: AdminOverviewResponse["relay"]): string {
  const statusText = relay.enabled
    ? `Relay active · ${relay.upstreamHost}:${String(relay.upstreamPort)}`
    : "Relay paused";
  return relay.smtpTlsCertExpiresAt === null
    ? statusText
    : `${statusText} · TLS cert expires ${formatPacificDate(relay.smtpTlsCertExpiresAt)}`;
}

export function buildOutboxFigures(
  overview: AdminOverviewResponse,
): readonly Figure[] {
  const { counts, relay } = overview;
  const activeHint =
    counts.active > 0
      ? `${String(counts.queued)} queued · ${String(counts.retrying)} retrying`
      : undefined;
  return [
    {
      label: "Queued / retrying",
      value: counts.active,
      severity: counts.active > 0 ? "warning" : "ok",
      ...(activeHint === undefined ? {} : { hint: activeHint }),
    },
    {
      label: "Sent (24h)",
      value: counts.sent24h,
      severity: "ok",
    },
    {
      label: "Failed (24h)",
      value: counts.failed24h,
      severity: counts.failed24h > 0 ? "error" : "ok",
    },
    {
      label: "Stored",
      value: counts.all,
      hint: `${String(relay.retentionDays)}d retention`,
    },
  ];
}

export function formatSenderCount(
  stats: AdminClientStats | undefined,
): string | number | undefined {
  if (stats === undefined) {
    return undefined;
  }
  if (stats.activeCount > 0) {
    return `${String(stats.activeCount)}/${String(stats.totalCount)}`;
  }
  return stats.totalCount > 0 ? stats.totalCount : undefined;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb < 10 ? kb.toFixed(1) : String(Math.round(kb))} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export function formatDurationMs(durationMs: number): string {
  return durationMs < 1000
    ? `${String(durationMs)}ms`
    : `${(durationMs / 1000).toFixed(2)}s`;
}

export function formatRecipientsCompact(recipients: readonly string[]): string {
  const first = recipients[0];
  if (first === undefined) {
    return "—";
  }
  return recipients.length === 1
    ? first
    : `${first} +${String(recipients.length - 1)}`;
}

export function defaultDetailTab(
  detail: Pick<AdminMessageDetail, "plainBody" | "htmlBody">,
): DetailTab {
  if (detail.plainBody !== null && detail.plainBody.length > 0) {
    return "plain";
  }
  return detail.htmlBody !== null && detail.htmlBody.length > 0
    ? "html"
    : "diagnostics";
}

export function formatDiagnosticSummary(
  detail: Pick<
    AdminMessageDetail,
    "lastError" | "lastSmtpCode" | "lastSmtpResponse"
  >,
): {
  readonly label: string;
  readonly value: string;
  readonly isError: boolean;
} {
  const codePrefix =
    detail.lastSmtpCode === null ? null : String(detail.lastSmtpCode);
  if (detail.lastError !== null && detail.lastError.length > 0) {
    const value =
      codePrefix === null
        ? detail.lastError
        : `${codePrefix} — ${detail.lastError}`;
    return { label: "Last Error", value, isError: true };
  }
  if (detail.lastSmtpResponse !== null && detail.lastSmtpResponse.length > 0) {
    const value =
      codePrefix === null
        ? detail.lastSmtpResponse
        : `${codePrefix} ${detail.lastSmtpResponse}`;
    return { label: "Fastmail SMTP Response", value, isError: false };
  }
  return {
    label: "Fastmail SMTP Response",
    value: codePrefix ?? "—",
    isError: false,
  };
}
