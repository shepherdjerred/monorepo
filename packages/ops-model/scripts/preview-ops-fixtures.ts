import {
  buildAlertOpeningDocument,
  type AlertEmailInputItem,
} from "@shepherdjerred/ops-model/email/alert-context.ts";
import {
  OPS_MAILBOXES,
  reportMailboxForType,
} from "@shepherdjerred/ops-model/email/mailbox.ts";
import type { EmailDocument } from "@shepherdjerred/ops-model/email/primitives.ts";
import { APP_HOSTS, TOOL_HOSTS } from "@shepherdjerred/ops-model/tool-links.ts";

export type PreviewScenario = {
  id: string;
  category: "Alerts" | "Hub Digests" | "Temporal Reports";
  label: string;
  from: string;
  to: string;
  subject: string;
  legacyFrom: string;
  legacyTo: string;
  legacySubject: string;
  legacyHtml: string;
  document: EmailDocument;
};

const CRITICAL_NONDETERMINISM: AlertEmailInputItem = {
  id: "alert_d66131bcb7ff1dc077f80baaff4d1797",
  alertname: "TemporalWorkflowNondeterministic",
  namespace: "temporal",
  severity: "critical",
  summary: "Workflow stuck after a code change",
  openedAtIso: "2026-11-20T06:28:28.395Z",
  labels: {
    alertname: "TemporalWorkflowNondeterministic",
    endpoint: "metrics",
    exported_namespace: "prod",
    instance: "10.244.0.140:9464",
    job: "temporal-delivery-wf-retained-fe0dff78f2fa-metrics-service",
    namespace: "temporal",
    pod: "temporal-delivery-wf-retained-fe0dff78f2fa-645d797879-r27hl",
    prometheus: "prometheus/prometheus-kube-prometheus-prometheus",
    severity: "critical",
    task_queue: "monorepo-workflows",
    workflow_type: "photonConversationWorkflow",
  },
  annotations: {
    description:
      "In-flight chat runs are paused because the latest worker code no longer matches saved workflow history. Pause the worker rollout and test replay locally before redeploying.",
  },
};

const STREAMBOT_POD_1: AlertEmailInputItem = {
  id: "alert_20ea2231bd48aa901b80e659ddc2dcf0",
  alertname: "StreambotEncoderProducerAhead",
  namespace: "media",
  severity: "warning",
  summary: "Stream video is running ahead of audio",
  openedAtIso: "2026-11-20T04:49:58.507Z",
  labels: {
    alertname: "StreambotEncoderProducerAhead",
    app: "streambot",
    instance: "10.244.0.57:9466",
    namespace: "media",
    pod: "media-streambot-b566d5575-8j5nm",
    severity: "warning",
  },
  annotations: {
    description:
      "Discord viewers may notice brief ~1-second freezes while video buffers fill up. Check that the stream read-rate throttle is enabled on Streambot.",
  },
};

const STREAMBOT_POD_2: AlertEmailInputItem = {
  ...STREAMBOT_POD_1,
  id: "alert_c36f52038adae1e8567699318e750890",
  labels: { ...STREAMBOT_POD_1.labels, pod: "media-streambot-b566d5575-k42qp" },
};

const GOLINK_CRITICAL: AlertEmailInputItem = {
  id: "alert_67e32b8a9756afee133389b098d96e31",
  alertname: "GolinkAuthkeyIgnored",
  namespace: "golink",
  severity: "critical",
  summary: "Shortlinks may stop working — Tailscale sign-in failed",
  openedAtIso: "2026-11-20T06:29:57.535Z",
  labels: {
    alertname: "GolinkAuthkeyIgnored",
    app: "golink",
    namespace: "golink",
    node_name: "torvalds",
    pod: "golink-5b867676c4-p7ltc",
    severity: "critical",
  },
  annotations: {
    description:
      "Golink booted with leftover state on disk and rejected its Tailscale login key. Clear the stale state file or re-authenticate Golink.",
  },
};

const FALLBACK_HUB_DOWN: AlertEmailInputItem = {
  id: "alert_fallback_hub_down",
  alertname: "AlertDashboardDown",
  namespace: "alert-dashboard",
  severity: "critical",
  summary: "Alert dashboard is offline",
  openedAtIso: "2026-11-20T07:05:00.000Z",
  labels: {
    alertname: "AlertDashboardDown",
    alert_dashboard_fallback: "true",
    namespace: "alert-dashboard",
    severity: "critical",
  },
  annotations: {
    description:
      "Hub is unreachable, so alert web pages and normal incident emails are paused. Inspect the alert-dashboard pod and recent deployments.",
  },
};

function stockAlertmanagerHtml(alert: AlertEmailInputItem): string {
  const labelRows = Object.entries(alert.labels)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 8px;border:1px solid #ddd;font-family:monospace;font-size:12px;">${k}</td><td style="padding:4px 8px;border:1px solid #ddd;font-family:monospace;font-size:12px;">${v}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html><body style="margin:0;padding:16px;background:#f5f5f5;font-family:Helvetica,Arial,sans-serif;"><div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #ccc;"><div style="background:#E6522C;color:#fff;padding:18px 20px;font-size:20px;font-weight:bold;">[FIRING:1] ${alert.alertname}</div><div style="padding:16px;"><p><a href="https://alertmanager.tailnet-1a49.ts.net">View in AlertManager</a></p><h3>Alerts Firing:</h3><p><strong>Labels:</strong></p><table style="border-collapse:collapse;width:100%;">${labelRows}</table><p><strong>Annotations:</strong></p><p style="font-size:13px;">description = ${alert.annotations["description"] ?? ""}<br>summary = ${alert.summary}</p></div></div></body></html>`;
}

const DAILY_DIGEST_DOC: EmailDocument = {
  eyebrow: "Hub · Daily Digest",
  tone: "warning",
  badge: "2 Need Review",
  preheader: "2 items need your review; 19 of 20 services are healthy.",
  heading: "Morning check-in · Friday, Nov 20",
  lead: "19 of 20 services are healthy. Two items are waiting on your decision.",
  actionsAboveSections: true,
  sections: [
    {
      kind: "items",
      heading: "Waiting on you",
      items: [
        {
          tone: "warning",
          kicker: "Delivery",
          badge: "Approval",
          title: "Approve 2 Cloudflare DNS records for sjer.red",
          body: "Adds DMARC email authentication records queued by OpenTofu.",
          links: [{ label: "Review in Delivery", url: APP_HOSTS.delivery }],
        },
        {
          tone: "info",
          kicker: "Tracker",
          badge: "Decision",
          title: "Decide whether to turn off legacy Seerr emails",
          body: "Media now handles household request notifications directly.",
          links: [
            { label: "Open AI-606", url: `${APP_HOSTS.tracker}/issues/AI-606` },
          ],
        },
      ],
    },
    {
      kind: "items",
      heading: "Needs attention",
      items: [
        {
          tone: "warning",
          kicker: "Streambot",
          badge: "Warning",
          title: "Stream video briefly ran ahead of audio on 2 pods",
          body: "3 short occurrences opened and cleared automatically (median 9 min).",
          links: [
            {
              label: "Streambot page",
              url: `${APP_HOSTS.hub}/services/streambot`,
            },
          ],
        },
      ],
    },
    {
      kind: "timeline",
      heading: "Recent activity (24h)",
      emptyText: "No changes recorded.",
      rows: [
        {
          time: "18:12",
          kind: "Deploy",
          title: "Hub rolled out to production",
          url: APP_HOSTS.delivery,
        },
        {
          time: "07:13",
          kind: "Resolved",
          title: "Temporal workflow mismatch cleared",
          url: `${APP_HOSTS.hub}/alerts`,
        },
        {
          time: "06:58",
          kind: "Upgrade",
          title: "Talos 1.14.6 completed on torvalds",
        },
      ],
    },
  ],
  primaryAction: { label: "Open Hub", url: APP_HOSTS.hub },
  secondaryActions: [
    { label: "Delivery", url: APP_HOSTS.delivery },
    { label: "Tracker", url: APP_HOSTS.tracker },
  ],
  details: [
    {
      label: "Window",
      value: "Nov 19, 7:30 AM – Nov 20, 7:30 AM PST",
      mono: false,
    },
    {
      label: "Incidents",
      value: "3 opened · 3 resolved (median 9 min)",
      mono: false,
    },
  ],
};

const WEEKLY_DIGEST_DOC: EmailDocument = {
  eyebrow: "Hub · Weekly Review",
  tone: "ok",
  badge: "All Clear",
  preheader:
    "All clear for Nov 13–20: 47 PRs merged, 31 deploys, $18.40 AI spend, 0 open alerts.",
  heading: "Weekly review · Nov 13–20",
  lead: "Every service is green and nothing is waiting on you.",
  actionsAboveSections: true,
  sections: [
    {
      kind: "metrics",
      heading: "This week vs. last week",
      rows: [
        {
          label: "Pull requests merged",
          value: "47",
          delta: "+12",
          deltaTone: "good",
        },
        {
          label: "Median time to merge",
          value: "1.4 hr",
          delta: "-0.5 hr",
          deltaTone: "good",
        },
        {
          label: "Production deploys",
          value: "31",
          delta: "+6",
          deltaTone: "good",
        },
        {
          label: "Incidents opened / resolved",
          value: "5 / 5",
          delta: "-4 opened",
          deltaTone: "good",
        },
        {
          label: "Cluster AI spend",
          value: "$18.40",
          delta: "-$3.10",
          deltaTone: "good",
        },
        {
          label: "Open app errors (Bugsink)",
          value: "2",
          delta: "-3",
          deltaTone: "good",
        },
      ],
    },
  ],
  primaryAction: {
    label: "Open Weekly Review",
    url: `${APP_HOSTS.hub}/review`,
  },
  details: [
    { label: "Period", value: "Nov 13 – Nov 20, 2026 (PST)", mono: false },
  ],
};

const HOMELAB_AUDIT_DOC: EmailDocument = {
  eyebrow: "Homelab Check",
  tone: "warning",
  badge: "Review Needed",
  preheader:
    "CI cache disk is 83% full (about 9 days left); 11 other homelab checks passed.",
  heading: "CI cache disk is 83% full",
  lead: "At this week's growth rate, the Woodpecker CI cache volume will fill up in about 9 days unless old cached packages are cleaned up.",
  nextStep:
    "Prune old CI cache entries or expand the volume before it hits 90%.",
  actionsAboveSections: true,
  sections: [
    {
      kind: "checks",
      heading: "Health checks",
      attentionChecks: [],
      passedLabels: [
        "Cluster nodes",
        "Kubernetes pods",
        "Argo CD sync",
        "ZFS storage pools",
        "SSD health & wear",
        "Nightly backups",
        "Object storage",
        "Postal mail queue",
        "Public HTTPS & tunnels",
        "Scheduled jobs",
        "Feature flags",
      ],
    },
  ],
  primaryAction: {
    label: "Open storage dashboard",
    url: `${TOOL_HOSTS.grafana}/d/kubelet`,
  },
  secondaryActions: [
    {
      label: "Workflow run",
      url: `${TOOL_HOSTS.temporal}/namespaces/prod/workflows/homelab-audit-daily`,
    },
    { label: "Open Hub", url: APP_HOSTS.hub },
  ],
  details: [
    { label: "Volume", value: "woodpecker-cache-pvc (53.1 / 64 GiB)" },
    { label: "Node", value: "liskov" },
    { label: "Checked", value: "Nov 20, 6:31 AM PST", mono: false },
    { label: "Schedule", value: "homelab-audit-daily" },
  ],
};

const SCOUT_REPORT_DOC: EmailDocument = {
  eyebrow: "Scout Automation",
  tone: "ok",
  badge: "No Action Needed",
  preheader:
    "League patch 26.23 data was generated and PR #4592 is set to auto-merge.",
  heading: "League patch 26.23 update PR opened",
  lead: "Riot published patch 26.23. Champion, item, and rune data were updated in PR #4592 and will merge automatically when CI finishes.",
  actionsAboveSections: true,
  sections: [
    {
      kind: "checks",
      heading: "Checks completed",
      attentionChecks: [],
      passedLabels: [
        "Riot patch version check",
        "171 champions, 244 items & 63 runes updated",
        "Backend snapshot tests",
        "Auto-merge enabled",
      ],
    },
  ],
  primaryAction: {
    label: "View PR #4592",
    url: `${TOOL_HOSTS.github}/pull/4592`,
  },
  details: [
    { label: "Patch", value: "26.22 → 26.23", mono: false },
    { label: "Completed", value: "Nov 20, 6:14 AM PST", mono: false },
    { label: "Schedule", value: "scout-data-dragon-version-check" },
  ],
};

export function buildPreviewScenarios(): PreviewScenario[] {
  const singleCritical = buildAlertOpeningDocument({
    alerts: [CRITICAL_NONDETERMINISM],
  });
  const groupedBurst = buildAlertOpeningDocument({
    alerts: [GOLINK_CRITICAL, STREAMBOT_POD_1, STREAMBOT_POD_2],
  });
  const fallbackAlert = buildAlertOpeningDocument({
    alerts: [FALLBACK_HUB_DOWN],
    fallbackChannel: true,
  });
  const homelabMailbox = reportMailboxForType("homelab-audit");
  const scoutMailbox = reportMailboxForType("scout-data-dragon");

  return [
    {
      id: "alert-critical-single",
      category: "Alerts",
      label: "1. Critical Alert (Single)",
      from: OPS_MAILBOXES.alerts.from,
      to: OPS_MAILBOXES.alerts.to,
      subject: singleCritical.subject,
      legacyFrom: "alerts@sjer.red",
      legacyTo: "claude@sjer.red",
      legacySubject:
        "[FIRING:1] TemporalWorkflowNondeterministic (temporal delivery-wf-retained-fe0dff78f2fa metrics prod NonDeterminismError 10.244.0.140:9464 critical)",
      legacyHtml: stockAlertmanagerHtml(CRITICAL_NONDETERMINISM),
      document: singleCritical.document,
    },
    {
      id: "alert-grouped-burst",
      category: "Alerts",
      label: "2. Multi-Alert & Grouped Pods",
      from: OPS_MAILBOXES.alerts.from,
      to: OPS_MAILBOXES.alerts.to,
      subject: groupedBurst.subject,
      legacyFrom: "alerts@sjer.red",
      legacyTo: "dependencies@sjer.red",
      legacySubject: "[Alerts] 3 critical alerts opened",
      legacyHtml: `<h1>Alerts opened</h1><ul><li><strong>golink ignored its TS_AUTHKEY on boot</strong> <code>golink</code><br><code>GolinkAuthkeyIgnored</code></li><li><strong>ffmpeg producing &gt; 1.25x realtime sustained</strong> <code>media</code><br><code>StreambotEncoderProducerAhead</code></li></ul><p><a href="https://alerts.tailnet-1a49.ts.net/alerts">Open Alerts</a></p>`,
      document: groupedBurst.document,
    },
    {
      id: "alert-fallback",
      category: "Alerts",
      label: "3. Alertmanager Fallback (Hub Down)",
      from: OPS_MAILBOXES.alertFallback.from,
      to: OPS_MAILBOXES.alertFallback.to,
      subject: fallbackAlert.subject,
      legacyFrom: "alerts@sjer.red",
      legacyTo: "claude@sjer.red",
      legacySubject:
        "[FIRING:1] AlertDashboardDown (alert-dashboard true critical)",
      legacyHtml: stockAlertmanagerHtml(FALLBACK_HUB_DOWN),
      document: fallbackAlert.document,
    },
    {
      id: "digest-daily-action",
      category: "Hub Digests",
      label: "4. Hub Daily Digest (Action Needed)",
      from: OPS_MAILBOXES.digests.from,
      to: OPS_MAILBOXES.digests.to,
      subject: "Daily digest: 2 items need your review",
      legacyFrom: "alerts@sjer.red",
      legacyTo: "dependencies@sjer.red",
      legacySubject: "[Hub] Daily digest 2026-11-20: 2 waiting on you",
      legacyHtml: `<div style="padding:20px;font-family:sans-serif;background:#f9f9f7;"><div style="max-width:600px;margin:0 auto;background:#fcfcfb;border:1px solid #e1e0d9;border-radius:12px;padding:24px;"><h1>Daily ops digest</h1><p>Legacy digest routed to dependencies@sjer.red.</p></div></div>`,
      document: DAILY_DIGEST_DOC,
    },
    {
      id: "digest-weekly-clear",
      category: "Hub Digests",
      label: "5. Hub Weekly Review (Trends)",
      from: OPS_MAILBOXES.digests.from,
      to: OPS_MAILBOXES.digests.to,
      subject: "Weekly review: All clear (Nov 13–20)",
      legacyFrom: "alerts@sjer.red",
      legacyTo: "dependencies@sjer.red",
      legacySubject: "[Hub] Weekly digest 2026-W47: OK",
      legacyHtml: `<div style="padding:20px;font-family:sans-serif;background:#f9f9f7;"><div style="max-width:600px;margin:0 auto;background:#fcfcfb;border:1px solid #e1e0d9;border-radius:12px;padding:24px;"><h1>Weekly ops review</h1></div></div>`,
      document: WEEKLY_DIGEST_DOC,
    },
    {
      id: "report-homelab-audit",
      category: "Temporal Reports",
      label: "6. Homelab Check (Review Needed)",
      from: homelabMailbox.from,
      to: homelabMailbox.to,
      subject: "Homelab check: CI cache disk is 83% full",
      legacyFrom: "deps@sjer.red",
      legacyTo: "dependencies@sjer.red",
      legacySubject: "Action needed: homelab issues found",
      legacyHtml: `<div style="padding:20px;background:#f3f4f6;font-family:sans-serif;"><div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;"><h1>Action needed: homelab issues found</h1><p>Sent from deps@sjer.red to dependencies@sjer.red with full-height check list.</p></div></div>`,
      document: HOMELAB_AUDIT_DOC,
    },
    {
      id: "report-scout-dd",
      category: "Temporal Reports",
      label: "7. Scout Data Dragon (Updated)",
      from: scoutMailbox.from,
      to: scoutMailbox.to,
      subject: "Scout update: League patch 26.23 PR opened",
      legacyFrom: "deps@sjer.red",
      legacyTo: "dependencies@sjer.red",
      legacySubject: "Scout Data Dragon update created",
      legacyHtml: `<div style="padding:20px;background:#f3f4f6;font-family:sans-serif;"><div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;"><h1>Scout Data Dragon update created</h1></div></div>`,
      document: SCOUT_REPORT_DOC,
    },
  ];
}
