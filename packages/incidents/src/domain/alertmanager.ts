/**
 * Alertmanager webhook → incident signals, through the curated rule table.
 * Alerts whose alertname is not curated are counted and ignored, so a route
 * that sends more than it should cannot open incidents nobody designed.
 */
import { incidentAlertRule } from "#shared/alert-rules.ts";
import type { IncidentLinkInput } from "#shared/contract.ts";
import type {
  AlertmanagerWebhook,
  AlertmanagerWebhookAlert,
} from "#shared/alertmanager.ts";
import type { IncidentSignal } from "#domain/signals.ts";

const TITLE_MAX = 200;
const SUMMARY_MAX = 20_000;
/** Alertmanager's "no end yet" sentinel year. */
const ZERO_TIME_YEAR = 1;

function absoluteHttpUrl(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function observedAt(alert: AlertmanagerWebhookAlert): string {
  if (alert.status === "firing") return alert.startsAt;
  return new Date(alert.endsAt).getUTCFullYear() > ZERO_TIME_YEAR
    ? alert.endsAt
    : alert.startsAt;
}

function alertLinks(
  alert: AlertmanagerWebhookAlert,
  alertname: string,
): IncidentLinkInput[] {
  const generator = absoluteHttpUrl(alert.generatorURL);
  const runbook = absoluteHttpUrl(alert.annotations["runbook_url"]);
  return [
    {
      kind: "alert",
      ref: alert.fingerprint,
      title: alertname,
      ...(generator === undefined ? {} : { url: generator }),
    },
    ...(runbook === undefined
      ? []
      : [
          {
            kind: "url" as const,
            ref: runbook,
            url: runbook,
            title: "Runbook",
          },
        ]),
  ];
}

export type AlertmanagerTranslation = {
  readonly signals: IncidentSignal[];
  /** Alerts whose alertname has no curated rule. */
  readonly ignored: number;
};

export function alertmanagerSignals(
  webhook: AlertmanagerWebhook,
): AlertmanagerTranslation {
  const signals: IncidentSignal[] = [];
  let ignored = 0;
  for (const alert of webhook.alerts) {
    const alertname = alert.labels["alertname"] ?? "";
    const rule = incidentAlertRule(alertname);
    if (rule === null) {
      ignored += 1;
      continue;
    }
    const title = (alert.annotations["summary"] ?? alertname).slice(
      0,
      TITLE_MAX,
    );
    signals.push({
      source: "alertmanager",
      key: alert.fingerprint,
      firing: alert.status === "firing",
      system: rule.system,
      severity: rule.severity,
      title: title.length >= 3 ? title : alertname,
      summary: (
        alert.annotations["message"] ??
        alert.annotations["description"] ??
        ""
      ).slice(0, SUMMARY_MAX),
      exitCondition: rule.exitCondition,
      observedAt: observedAt(alert),
      links: alertLinks(alert, alertname),
    });
  }
  return { signals, ignored };
}
