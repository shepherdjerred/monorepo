import { Temporal } from "@js-temporal/polyfill";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import type { Signal } from "@shepherdjerred/ops-model/snapshot.ts";

import { ALERTS_PUBLIC_URL } from "#domain/ops-changes";
import { DIGEST_TIME_ZONE } from "#domain/ops-period";
import type { ChangeView, DigestReport, Trend } from "#shared/ops-schema";
import {
  SEVERITY_LABEL,
  formatDelta,
  formatValue,
  trendDelta,
} from "#shared/ops-format";

const MAX_SIGNALS = 15;
const MAX_CHANGES = 25;

/** Status colors with a text label beside them; never color alone. */
const SEVERITY_STYLE: Record<Severity, { background: string; ink: string }> = {
  ok: { background: "#e3f4e3", ink: "#0a5c0a" },
  info: { background: "#e1edfb", ink: "#1c5cab" },
  unknown: { background: "#ecebe7", ink: "#52514e" },
  warning: { background: "#fff1cf", ink: "#7a5200" },
  error: { background: "#fbe4e4", ink: "#9d241e" },
};

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** `Sep 24 12:29` in the digest's time zone. */
function localTime(instant: string): string {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(DIGEST_TIME_ZONE)
    .toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
}

function pill(severity: Severity): string {
  const style = SEVERITY_STYLE[severity];
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${style.background};color:${style.ink};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em">${SEVERITY_LABEL[severity]}</span>`;
}

function heading(text: string): string {
  return `<h2 style="margin:28px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:0.06em;color:#52514e">${escapeHtml(text)}</h2>`;
}

function signalLink(signal: Signal): string {
  const link = signal.links[0];
  const title = escapeHtml(signal.title);
  return link === undefined
    ? title
    : `<a href="${escapeHtml(link.url)}" style="color:#0b0b0b">${title}</a>`;
}

function signalRows(signals: readonly Signal[], empty: string): string {
  if (signals.length === 0)
    return `<p style="margin:0;color:#52514e">${escapeHtml(empty)}</p>`;
  const rows = signals
    .slice(0, MAX_SIGNALS)
    .map((signal) => {
      const detail =
        signal.detail === undefined
          ? ""
          : `<div style="color:#52514e;font-size:13px">${escapeHtml(signal.detail)}</div>`;
      return `<tr><td style="width:92px;padding:8px 10px 8px 0;vertical-align:top;white-space:nowrap">${pill(signal.severity)}</td><td style="padding:8px 0;border-bottom:1px solid #e1e0d9">${signalLink(signal)}${detail}</td></tr>`;
    })
    .join("");
  const more =
    signals.length > MAX_SIGNALS
      ? `<p style="margin:6px 0 0;color:#52514e;font-size:13px">and ${String(signals.length - MAX_SIGNALS)} more on the dashboard</p>`
      : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">${rows}</table>${more}`;
}

function changeRows(changes: readonly ChangeView[]): string {
  if (changes.length === 0)
    return `<p style="margin:0;color:#52514e">No changes recorded.</p>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">${changes
    .slice(0, MAX_CHANGES)
    .map((change) => {
      const time = localTime(change.occurredAt);
      const title = escapeHtml(change.title);
      const body =
        change.url === undefined
          ? title
          : `<a href="${escapeHtml(change.url)}" style="color:#0b0b0b">${title}</a>`;
      return `<tr><td style="padding:6px 10px 6px 0;color:#52514e;font-size:12px;white-space:nowrap;vertical-align:top;font-family:ui-monospace,Menlo,monospace">${time}</td><td style="padding:6px 10px 6px 0;font-size:12px;color:#52514e;white-space:nowrap;vertical-align:top">${escapeHtml(change.kind)}</td><td style="padding:6px 0;font-size:14px">${body}</td></tr>`;
    })
    .join("")}</table>`;
}

function trendRows(trends: readonly Trend[]): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">${trends
    .map((trend) => {
      const delta = trendDelta(trend);
      const good =
        delta === null || delta === 0
          ? null
          : delta > 0 === trend.higherIsBetter;
      const color = good === null ? "#52514e" : good ? "#006300" : "#9d241e";
      return `<tr><td style="padding:6px 0;border-bottom:1px solid #e1e0d9">${escapeHtml(trend.label)}</td><td style="padding:6px 0;border-bottom:1px solid #e1e0d9;text-align:right;font-weight:700">${formatValue(trend.current, trend.unit)}</td><td style="padding:6px 0 6px 12px;border-bottom:1px solid #e1e0d9;text-align:right;color:${color};font-size:13px;white-space:nowrap">${formatDelta(delta, trend.unit)}</td></tr>`;
    })
    .join("")}</table>`;
}

function subject(report: DigestReport): string {
  const label = report.kind === "daily" ? "Daily" : "Weekly";
  const needs = report.needsMe.length;
  const suffix =
    needs === 0
      ? SEVERITY_LABEL[report.status.severity]
      : `${String(needs)} waiting on you`;
  return `[Ops] ${label} digest ${report.periodKey}: ${suffix}`;
}

function htmlBody(report: DigestReport): string {
  const incidents = report.incidents;
  const title =
    report.kind === "daily" ? "Daily ops digest" : "Weekly ops review";
  const stale = report.status.stale
    ? `<p style="margin:8px 0 0;color:#7a5200">The latest snapshot is stale; treat green as unknown.</p>`
    : "";
  const sections = [
    heading("Waiting on you"),
    signalRows(report.needsMe, "Nothing is waiting on you."),
    heading("Needs attention"),
    signalRows(report.attention, "Nothing needs attention."),
    heading(
      report.kind === "daily" ? "New since the last digest" : "New this week",
    ),
    signalRows(report.newSinceLast, "Nothing new."),
    ...(report.trends.length === 0
      ? []
      : [heading("Trends vs. previous week"), trendRows(report.trends)]),
    heading("Incidents"),
    `<p style="margin:0">${String(incidents.opened)} opened · ${String(incidents.resolved)} resolved · median time to resolve ${incidents.medianMinutesToResolve === null ? "—" : `${String(Math.round(incidents.medianMinutesToResolve))} min`}</p>`,
    heading(
      report.kind === "daily"
        ? "Changes in the last 24 hours"
        : "Changes this week",
    ),
    changeRows(report.changes),
  ].join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(title)}</title></head><body style="margin:0;background:#f9f9f7;font-family:${FONT};color:#0b0b0b"><div style="max-width:640px;margin:0 auto;padding:24px 16px"><div style="background:#fcfcfb;border:1px solid #e1e0d9;border-radius:12px;padding:24px"><p style="margin:0;color:#176b4d;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase">Ops · ${escapeHtml(report.periodKey)}</p><h1 style="margin:6px 0 12px;font-size:24px">${escapeHtml(title)}</h1><p style="margin:0">${pill(report.status.severity)} <span style="margin-left:6px">${escapeHtml(report.status.summary)}</span></p>${stale}${sections}<p style="margin:28px 0 0"><a href="${ALERTS_PUBLIC_URL}/" style="display:inline-block;padding:10px 14px;border-radius:7px;background:#176b4d;color:#ffffff;text-decoration:none;font-weight:700">Open Ops</a></p></div></div></body></html>`;
}

function textSignals(signals: readonly Signal[], empty: string): string {
  return signals.length === 0
    ? `  ${empty}`
    : signals
        .slice(0, MAX_SIGNALS)
        .map(
          (signal) =>
            `  - [${SEVERITY_LABEL[signal.severity]}] ${signal.title}${signal.links[0] === undefined ? "" : ` <${signal.links[0].url}>`}`,
        )
        .join("\n");
}

function textBody(report: DigestReport): string {
  const lines = [
    `${report.kind === "daily" ? "Daily ops digest" : "Weekly ops review"} ${report.periodKey}`,
    `Status: ${SEVERITY_LABEL[report.status.severity]} — ${report.status.summary}`,
    ...(report.status.stale
      ? ["The latest snapshot is stale; treat green as unknown."]
      : []),
    "",
    "Waiting on you:",
    textSignals(report.needsMe, "Nothing is waiting on you."),
    "",
    "Needs attention:",
    textSignals(report.attention, "Nothing needs attention."),
    "",
    "New:",
    textSignals(report.newSinceLast, "Nothing new."),
    ...(report.trends.length === 0
      ? []
      : [
          "",
          "Trends vs. previous week:",
          ...report.trends.map(
            (trend) =>
              `  - ${trend.label}: ${formatValue(trend.current, trend.unit)} (${formatDelta(trendDelta(trend), trend.unit)})`,
          ),
        ]),
    "",
    `Incidents: ${String(report.incidents.opened)} opened, ${String(report.incidents.resolved)} resolved`,
    "",
    "Changes:",
    ...(report.changes.length === 0
      ? ["  No changes recorded."]
      : report.changes
          .slice(0, MAX_CHANGES)
          .map(
            (change) =>
              `  - ${change.occurredAt} ${change.kind}: ${change.title}`,
          )),
    "",
    `Open Ops: ${ALERTS_PUBLIC_URL}/`,
  ];
  return `${lines.join("\n")}\n`;
}

export function renderDigestEmail(report: DigestReport): {
  subject: string;
  htmlBody: string;
  textBody: string;
} {
  return {
    subject: subject(report),
    htmlBody: htmlBody(report),
    textBody: textBody(report),
  };
}
