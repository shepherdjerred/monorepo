import { Temporal } from "@js-temporal/polyfill";
import { SERVICE_CATALOG } from "@shepherdjerred/ops-model/catalog.ts";
import type {
  EmailDocument,
  EmailItemCard,
  EmailMetricRow,
  EmailSection,
  EmailTimelineRow,
  EmailTone,
} from "@shepherdjerred/ops-model/email/primitives.ts";
import { renderEmailHtml } from "@shepherdjerred/ops-model/email/render-html.ts";
import { renderEmailText } from "@shepherdjerred/ops-model/email/render-text.ts";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import {
  groupSignals,
  type SignalEntry,
} from "@shepherdjerred/ops-model/signals/signal-groups.ts";
import type {
  SectionId,
  Signal,
  SourceId,
} from "@shepherdjerred/ops-model/snapshot.ts";
import {
  APP_HOSTS,
  hubDigestRunUrl,
} from "@shepherdjerred/ops-model/tool-links.ts";

import { DIGEST_TIME_ZONE } from "#domain/ops-period";
import {
  SEVERITY_LABEL,
  formatDelta,
  formatValue,
  trendDelta,
} from "#shared/ops-format";
import type { ChangeView, DigestReport, Trend } from "#shared/ops-schema";

/** Rows per list. A group of same-kind signals is one row. */
const MAX_SIGNALS = 15;
const MAX_CHANGES = 25;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const SERVICE_TITLES = new Map(
  SERVICE_CATALOG.services.map(
    (service) => [service.id, service.title] as const,
  ),
);

const SOURCE_LABELS: Record<SourceId, string> = {
  alerts: "Alerts",
  kubernetes: "Kubernetes",
  argocd: "Argo CD",
  talos: "Talos",
  ci: "CI",
  github: "GitHub",
  renovate: "Renovate",
  tracker: "Tracker",
  experiments: "Experiments",
  bugsink: "Bugsink",
  posthog: "PostHog",
  probes: "Probes",
  logs: "Logs",
  traces: "Traces",
  maintenance: "Maintenance",
  temporal: "Temporal",
  ai: "AI",
};

const SECTION_LABELS: Record<SectionId, string> = {
  alerts: "Alerts",
  platform: "Platform",
  product: "Product",
  delivery: "Delivery",
  errors: "Errors",
  observability: "Observability",
  work: "Work",
  maintenance: "Maintenance",
  ai: "AI",
};

const CHANGE_KIND_LABELS: Record<ChangeView["kind"], string> = {
  deploy: "Deploy",
  sync: "Synced",
  merge: "PR merged",
  "image-bump": "Image update",
  release: "Release",
  "alert-open": "Alert opened",
  "alert-resolve": "Resolved",
};

function severityToTone(severity: Severity): EmailTone {
  switch (severity) {
    case "error":
      return "critical";
    case "warning":
      return "warning";
    case "ok":
      return "ok";
    case "info":
      return "info";
    case "unknown":
      return "neutral";
  }
}

function plainDateInDigestZone(instant: string): Temporal.PlainDate {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(DIGEST_TIME_ZONE)
    .toPlainDate();
}

function formatShortDate(date: Temporal.PlainDate): string {
  const month = MONTHS[date.month - 1] ?? String(date.month);
  return `${month} ${String(date.day)}`;
}

/** Human period label (`Nov 20` for daily, `Nov 13–20` for weekly). */
function formatPeriodLabel(report: DigestReport): string {
  const end = plainDateInDigestZone(report.periodEnd);
  if (report.kind === "daily") {
    return formatShortDate(end);
  }
  const start = plainDateInDigestZone(report.periodStart);
  if (Temporal.PlainDate.compare(start, end) >= 0) {
    return formatShortDate(end);
  }
  if (start.month === end.month && start.year === end.year) {
    const month = MONTHS[start.month - 1] ?? String(start.month);
    return `${month} ${String(start.day)}–${String(end.day)}`;
  }
  return `${formatShortDate(start)} – ${formatShortDate(end)}`;
}

/** `Nov 20 19:45` in `DIGEST_TIME_ZONE`. */
function formatLocalTime(instant: string): string {
  const zdt =
    Temporal.Instant.from(instant).toZonedDateTimeISO(DIGEST_TIME_ZONE);
  const month = MONTHS[zdt.month - 1] ?? String(zdt.month);
  const hour = String(zdt.hour).padStart(2, "0");
  const minute = String(zdt.minute).padStart(2, "0");
  return `${month} ${String(zdt.day)} ${hour}:${minute}`;
}

function buildDigestSubject(report: DigestReport, periodLabel: string): string {
  const prefix = report.kind === "daily" ? "Daily digest" : "Weekly review";
  const needsCount = report.needsMe.length;
  if (needsCount > 0) {
    const noun = needsCount === 1 ? "item needs" : "items need";
    return `${prefix}: ${String(needsCount)} ${noun} your review`;
  }
  return report.status.severity === "ok" && !report.status.stale
    ? `${prefix}: All clear (${periodLabel})`
    : `${prefix}: Attention needed (${periodLabel})`;
}

function buildTopBadge(report: DigestReport): string {
  if (report.needsMe.length > 0) {
    return `${String(report.needsMe.length)} to review`;
  }
  if (report.status.severity === "ok" && !report.status.stale) {
    return "All clear";
  }
  return report.status.stale && report.status.severity === "ok"
    ? "Stale"
    : SEVERITY_LABEL[report.status.severity];
}

function signalKicker(signal: Signal): string {
  return signal.service === undefined
    ? SOURCE_LABELS[signal.source]
    : (SERVICE_TITLES.get(signal.service) ?? signal.service);
}

/**
 * The rows a list shows and how many signals they leave out. Same-kind
 * signals collapse into one row before the cap applies, so ten failed
 * restores cost one row rather than most of the list.
 */
function cappedEntries(signals: readonly Signal[]): {
  shown: SignalEntry[];
  hidden: number;
} {
  const shown = groupSignals(signals).slice(0, MAX_SIGNALS);
  const covered = shown.reduce(
    (count, entry) => count + (entry.type === "signal" ? 1 : entry.count),
    0,
  );
  return { shown, hidden: signals.length - covered };
}

function entryToCard(entry: SignalEntry): EmailItemCard {
  if (entry.type === "group") {
    return {
      tone: severityToTone(entry.severity),
      kicker: SECTION_LABELS[entry.section],
      badge:
        entry.severity === "error"
          ? "Critical"
          : SEVERITY_LABEL[entry.severity],
      title: entry.label,
    };
  }
  const { signal } = entry;
  const links = signal.links.map((link) => ({
    label: link.label,
    url: link.url,
  }));
  return {
    tone: severityToTone(signal.severity),
    kicker: signalKicker(signal),
    badge:
      signal.severity === "error"
        ? "Critical"
        : SEVERITY_LABEL[signal.severity],
    title: signal.title,
    ...(signal.detail === undefined ? {} : { body: signal.detail }),
    ...(links.length === 0 ? {} : { links }),
  };
}

function buildSignalsSection(
  heading: string,
  signals: readonly Signal[],
  emptyText?: string,
): EmailSection {
  const { shown, hidden } = cappedEntries(signals);
  return {
    kind: "items",
    heading,
    ...(emptyText === undefined ? {} : { emptyText }),
    items: shown.map((entry) => entryToCard(entry)),
    ...(hidden <= 0
      ? {}
      : { omittedNotice: `and ${String(hidden)} more in Hub.` }),
  };
}

function trendToMetricRow(trend: Trend): EmailMetricRow {
  const delta = trendDelta(trend);
  const deltaTone: EmailMetricRow["deltaTone"] =
    delta === null || delta === 0
      ? "neutral"
      : delta > 0 === trend.higherIsBetter
        ? "good"
        : "bad";
  return {
    label: trend.label,
    value: formatValue(trend.current, trend.unit),
    delta: formatDelta(delta, trend.unit),
    deltaTone,
  };
}

function changeToTimelineRow(change: ChangeView): EmailTimelineRow {
  return {
    time: formatLocalTime(change.occurredAt),
    kind: CHANGE_KIND_LABELS[change.kind],
    title: change.title,
    ...(change.url === undefined ? {} : { url: change.url }),
  };
}

function formatIncidentsDetail(incidents: DigestReport["incidents"]): string {
  const base = `${String(incidents.opened)} opened · ${String(incidents.resolved)} resolved`;
  return incidents.medianMinutesToResolve === null
    ? base
    : `${base} · median ${String(Math.round(incidents.medianMinutesToResolve))} min`;
}

export function buildDigestDocument(report: DigestReport): {
  subject: string;
  document: EmailDocument;
} {
  const periodLabel = formatPeriodLabel(report);
  const subject = buildDigestSubject(report, periodLabel);
  const heading =
    report.kind === "daily"
      ? `Morning check-in · ${periodLabel}`
      : `Weekly review · ${periodLabel}`;
  const topTone: EmailTone =
    report.status.stale && report.status.severity === "ok"
      ? "warning"
      : severityToTone(report.status.severity);

  const sections: EmailSection[] = [
    buildSignalsSection(
      "Waiting on you",
      report.needsMe,
      "Nothing is waiting on you.",
    ),
    buildSignalsSection(
      "Needs attention",
      report.attention,
      "Nothing needs attention.",
    ),
    ...(report.newSinceLast.length === 0
      ? []
      : [
          buildSignalsSection(
            report.kind === "daily" ? "New since last digest" : "New this week",
            report.newSinceLast,
          ),
        ]),
    ...(report.trends.length === 0
      ? []
      : [
          {
            kind: "metrics" as const,
            heading: "This week vs. last week",
            rows: report.trends.map((trend) => trendToMetricRow(trend)),
          },
        ]),
    {
      kind: "timeline",
      heading: "Recent activity",
      emptyText:
        report.kind === "daily"
          ? "No changes recorded in the last 24 hours."
          : "No changes recorded this week.",
      rows: report.changes
        .slice(0, MAX_CHANGES)
        .map((change) => changeToTimelineRow(change)),
    },
  ];

  const document: EmailDocument = {
    eyebrow: "Hub Digest",
    tone: topTone,
    badge: buildTopBadge(report),
    preheader: `${heading} — ${report.status.summary}`,
    heading,
    lead: report.status.summary,
    ...(report.status.stale
      ? {
          callout: {
            tone: "warning",
            title: "Snapshot is stale",
            text: "The latest snapshot is stale; treat green checks as unknown until ingestion recovers.",
          },
        }
      : {}),
    actionsAboveSections: false,
    sections,
    primaryAction: {
      label: "Open Hub",
      url: `${APP_HOSTS.hub}/`,
    },
    secondaryActions: [
      {
        label: "Open in Hub",
        url: hubDigestRunUrl(report.kind, report.periodKey),
      },
    ],
    details: [
      {
        label: "Window",
        value: `${formatLocalTime(report.periodStart)} – ${formatLocalTime(report.periodEnd)} PT`,
        mono: false,
      },
      {
        label: "Incidents",
        value: formatIncidentsDetail(report.incidents),
        mono: false,
      },
    ],
  };

  return { subject, document };
}

export function renderDigestEmail(report: DigestReport): {
  subject: string;
  htmlBody: string;
  plainBody: string;
} {
  const { subject, document } = buildDigestDocument(report);
  return {
    subject,
    htmlBody: renderEmailHtml(document),
    plainBody: renderEmailText(document),
  };
}
