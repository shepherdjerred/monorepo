import {
  SERVICE_CATALOG,
  ServiceIndex,
  type Service,
} from "@shepherdjerred/ops-model/catalog.ts";
import {
  APP_HOSTS,
  grafanaDashboardLink,
} from "@shepherdjerred/ops-model/tool-links.ts";
import {
  cleanAlertSummary,
  extractAlertDetails,
  resolveAlertService,
  splitAlertExplanation,
} from "./alert-humanize.ts";
import {
  safeHttpUrl,
  type EmailActionLink,
  type EmailDocument,
  type EmailItemCard,
  type EmailTone,
} from "./primitives.ts";

export type AlertEmailInputItem = {
  id: string;
  alertname: string;
  namespace: string | null;
  severity: "critical" | "warning" | "info" | "unknown";
  summary: string;
  openedAtIso?: string;
  labels: Readonly<Record<string, string>>;
  annotations: Readonly<Record<string, string>>;
};

export type BuildAlertEmailOptions = {
  alerts: readonly AlertEmailInputItem[];
  alertmanagerTruncatedAlerts?: number;
  hubBaseUrl?: string;
  services?: ServiceIndex;
  fallbackChannel?: boolean;
};

function severityTone(severity: AlertEmailInputItem["severity"]): EmailTone {
  switch (severity) {
    case "critical":
      return "critical";
    case "warning":
      return "warning";
    case "info":
      return "info";
    case "unknown":
      return "neutral";
  }
}

const SEVERITY_RANK: Record<AlertEmailInputItem["severity"], number> = {
  critical: 0,
  warning: 1,
  info: 2,
  unknown: 3,
};

type GroupedAlert = {
  representative: AlertEmailInputItem;
  service: Service | undefined;
  serviceLabel: string;
  cleanSummary: string;
  impact: string | undefined;
  nextStep: string | undefined;
  occurrences: AlertEmailInputItem[];
};

function groupAlerts(
  alerts: readonly AlertEmailInputItem[],
  services: ServiceIndex,
): GroupedAlert[] {
  const sorted = [...alerts].toSorted(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.alertname.localeCompare(b.alertname),
  );
  const groups = new Map<string, GroupedAlert>();
  for (const alert of sorted) {
    const { service, serviceLabel } = resolveAlertService(alert, services);
    const cleanSummary = cleanAlertSummary(
      alert.summary,
      alert.alertname,
      serviceLabel,
    );
    const { impact, nextStep } = splitAlertExplanation(
      alert.annotations,
      alert.summary,
    );
    const key = `${alert.severity}\0${serviceLabel}\0${alert.alertname}\0${cleanSummary}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        representative: alert,
        service,
        serviceLabel,
        cleanSummary,
        impact,
        nextStep,
        occurrences: [alert],
      });
    } else {
      existing.occurrences.push(alert);
    }
  }
  return [...groups.values()];
}

function lowercaseLeadPhrase(headline: string): string {
  const firstWord = headline.split(/\s+/u)[0] ?? "";
  const isProperOrAcronym =
    /^[A-Z]{2,}/u.test(firstWord) ||
    /^(?:Tailscale|GitHub|Cloudflare|PostgreSQL|MariaDB|Grafana|Prometheus|Alertmanager|Temporal|Scout|TaskNotes|Golink|Roborock|PetLibro|Velero|SeaweedFS|Discord|Home)\b/u.test(
      firstWord,
    );
  return isProperOrAcronym
    ? headline
    : headline.charAt(0).toLowerCase() + headline.slice(1);
}

function buildAlertSubject(
  groups: readonly GroupedAlert[],
  totalCount: number,
  fallbackChannel: boolean,
): string {
  const lead = groups[0];
  if (lead === undefined) {
    return fallbackChannel
      ? "Fallback: Alertmanager delivery was truncated"
      : "Warning: Alertmanager delivery was truncated";
  }
  const prefix = fallbackChannel
    ? "Fallback"
    : groups.length > 1
      ? `${String(totalCount)} alerts`
      : lead.representative.severity === "critical"
        ? "Critical"
        : "Warning";
  const phrase = lowercaseLeadPhrase(lead.cleanSummary);
  const core = `${lead.serviceLabel} ${phrase}`;
  const clamped = core.length > 62 ? `${core.slice(0, 59).trimEnd()}...` : core;
  const suffix =
    groups.length === 1 && lead.occurrences.length > 1
      ? ` (${String(lead.occurrences.length)} pods)`
      : groups.length > 1
        ? ` (+${String(groups.length - 1)} more)`
        : "";
  return `${prefix}: ${clamped}${suffix}`;
}

function groupTargetNames(group: GroupedAlert): string[] | undefined {
  return group.occurrences.length <= 1
    ? undefined
    : group.occurrences.map(
        (occ) =>
          occ.labels["pod"] ??
          occ.labels["node"] ??
          occ.labels["device"] ??
          occ.id.slice(0, 12),
      );
}

function groupLinks(
  group: GroupedAlert,
  hubBase: string,
  includePrimaryHubLink: boolean,
): EmailActionLink[] {
  const rep = group.representative;
  const multi = group.occurrences.length > 1;
  const dashboardUid = group.service?.grafanaDashboards[0];
  const runbookHref = safeHttpUrl(rep.annotations["runbook_url"]);
  return [
    ...(includePrimaryHubLink
      ? [
          {
            label: multi ? "Open alerts" : "Inspect incident",
            url: multi
              ? `${hubBase}/alerts`
              : `${hubBase}/alerts/${encodeURIComponent(rep.id)}`,
          },
        ]
      : []),
    ...(group.service === undefined
      ? []
      : [
          {
            label: `${group.service.title} page`,
            url: `${hubBase}/services/${encodeURIComponent(group.service.id)}`,
          },
        ]),
    ...(dashboardUid === undefined
      ? []
      : [
          {
            label: "Grafana",
            url: grafanaDashboardLink(dashboardUid).url,
          },
        ]),
    ...(runbookHref === null ? [] : [{ label: "Runbook", url: runbookHref }]),
  ];
}

function buildOmissionNotice(
  locallyOmitted: number,
  truncatedUpstream: number,
): string | undefined {
  const parts = [
    ...(locallyOmitted > 0
      ? [
          `${String(locallyOmitted)} more alert${locallyOmitted === 1 ? " is" : "s are"} open in Hub.`,
        ]
      : []),
    ...(truncatedUpstream > 0
      ? [
          `Alertmanager omitted ${String(truncatedUpstream)} alert${truncatedUpstream === 1 ? "" : "s"} from this batch.`,
        ]
      : []),
  ];
  return parts.length === 0 ? undefined : parts.join(" ");
}

function buildSingleAlertDocument(input: {
  group: GroupedAlert;
  subject: string;
  topTone: EmailTone;
  hasCritical: boolean;
  fallbackChannel: boolean;
  hubBase: string;
  omittedNotice: string | undefined;
}): { subject: string; document: EmailDocument } {
  const { group, hubBase, fallbackChannel, omittedNotice } = input;
  const rep = group.representative;
  const multi = group.occurrences.length > 1;
  const targets = groupTargetNames(group);

  return {
    subject: input.subject,
    document: {
      eyebrow: fallbackChannel
        ? `${group.serviceLabel} · Fallback`
        : group.serviceLabel,
      tone: input.topTone,
      badge: multi
        ? `${input.hasCritical ? "Critical" : "Warning"} · ${String(group.occurrences.length)} pods`
        : input.hasCritical
          ? "Critical"
          : "Warning",
      preheader:
        group.impact ??
        `${group.serviceLabel}: ${group.cleanSummary}. Open Hub to inspect logs and metrics.`,
      heading: group.cleanSummary,
      ...(group.impact === undefined ? {} : { lead: group.impact }),
      ...(group.nextStep === undefined ? {} : { nextStep: group.nextStep }),
      ...(fallbackChannel
        ? {
            callout: {
              tone: "warning",
              title: "Sent via Alertmanager fallback",
              text: "Hub or its webhook path is unreachable, so Alertmanager mailed this alert directly.",
            },
          }
        : {}),
      actionsAboveSections: true,
      sections: [],
      primaryAction: {
        label: multi ? "Open Hub Alerts" : "Open incident in Hub",
        url: multi
          ? `${hubBase}/alerts`
          : `${hubBase}/alerts/${encodeURIComponent(rep.id)}`,
      },
      secondaryActions: groupLinks(group, hubBase, false),
      details: extractAlertDetails(rep, {
        ...(targets === undefined ? {} : { targets }),
        hubAlertsUrl: `${hubBase}/alerts`,
      }),
      ...(omittedNotice === undefined ? {} : { omittedNotice }),
    },
  };
}

function groupToItemCard(group: GroupedAlert, hubBase: string): EmailItemCard {
  const rep = group.representative;
  const multi = group.occurrences.length > 1;
  const targets = groupTargetNames(group);
  const sevLabel =
    rep.severity === "critical"
      ? "Critical"
      : rep.severity === "warning"
        ? "Warning"
        : "Info";
  return {
    tone: severityTone(rep.severity),
    kicker: group.serviceLabel,
    badge: multi
      ? `${sevLabel} · ${String(group.occurrences.length)} pods`
      : sevLabel,
    title: group.cleanSummary,
    ...(group.impact === undefined ? {} : { body: group.impact }),
    ...(group.nextStep === undefined ? {} : { nextStep: group.nextStep }),
    details: extractAlertDetails(rep, {
      ...(targets === undefined ? {} : { targets }),
    }),
    links: groupLinks(group, hubBase, true),
  };
}

export function buildAlertOpeningDocument(options: BuildAlertEmailOptions): {
  subject: string;
  document: EmailDocument;
} {
  const services = options.services ?? new ServiceIndex(SERVICE_CATALOG);
  const hubBase = (options.hubBaseUrl ?? APP_HOSTS.hub).replace(/\/$/u, "");
  const fallbackChannel = options.fallbackChannel ?? false;
  const renderedInput = options.alerts.slice(0, 25);
  const omittedNotice = buildOmissionNotice(
    options.alerts.length - renderedInput.length,
    options.alertmanagerTruncatedAlerts ?? 0,
  );

  const groups = groupAlerts(renderedInput, services);
  const subject = buildAlertSubject(
    groups,
    options.alerts.length,
    fallbackChannel,
  );
  const hasCritical = options.alerts.some((a) => a.severity === "critical");
  const topTone: EmailTone = hasCritical ? "critical" : "warning";

  const singleGroup = groups.length === 1 ? groups[0] : undefined;
  if (singleGroup !== undefined) {
    return buildSingleAlertDocument({
      group: singleGroup,
      subject,
      topTone,
      hasCritical,
      fallbackChannel,
      hubBase,
      omittedNotice,
    });
  }

  const cards = groups.map((group) => groupToItemCard(group, hubBase));
  const serviceCount = new Set(groups.map((g) => g.serviceLabel)).size;
  const heading =
    serviceCount === 1
      ? `${String(groups.length)} issues on ${groups[0]?.serviceLabel ?? "cluster"}`
      : `${String(serviceCount)} services need attention`;

  return {
    subject,
    document: {
      eyebrow: fallbackChannel ? "Hub Alerts · Fallback" : "Hub Alerts",
      tone: topTone,
      badge: `${String(options.alerts.length)} Active`,
      preheader: `${heading}. Open Hub to inspect logs and occurrence history.`,
      heading,
      ...(fallbackChannel
        ? {
            lead: "Hub or its webhook path is unreachable, so Alertmanager mailed these alerts directly.",
          }
        : {}),
      actionsAboveSections: false,
      sections: [
        {
          kind: "items",
          items: cards,
          ...(omittedNotice === undefined ? {} : { omittedNotice }),
        },
      ],
      primaryAction: {
        label: "Open Hub Alerts",
        url: `${hubBase}/alerts`,
      },
    },
  };
}

export function buildAlertTruncationDocument(
  truncatedAlerts: number,
  hubBaseUrl: string = APP_HOSTS.hub,
): { subject: string; document: EmailDocument } {
  const hubBase = hubBaseUrl.replace(/\/$/u, "");
  return {
    subject: "Warning: Alertmanager batch was truncated",
    document: {
      eyebrow: "Hub",
      tone: "warning",
      badge: "Truncated",
      preheader: `Alertmanager omitted ${String(truncatedAlerts)} alert(s) from one webhook batch; Hub still syncs active alerts every 15s.`,
      heading: "Some alerts were left out of one delivery batch",
      lead: `Alertmanager dropped ${String(truncatedAlerts)} alert${truncatedAlerts === 1 ? "" : "s"} from a single webhook push because the batch limit was reached. Hub still pulls all active alerts every 15 seconds.`,
      nextStep: "Open Hub Alerts to review all currently active incidents.",
      sections: [],
      primaryAction: { label: "Open Hub Alerts", url: `${hubBase}/alerts` },
      details: [{ label: "Omitted alerts", value: String(truncatedAlerts) }],
    },
  };
}
