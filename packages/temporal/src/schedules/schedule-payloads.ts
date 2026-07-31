import type { AgentTaskInput } from "#shared/agent-task.ts";

// Large schedule `args` payloads, extracted from register-schedules.ts so that
// file stays within its line budget and its SCHEDULES array reads as a table of
// declarations rather than inline data blobs. Each constant is consumed only by
// a SCHEDULES entry's `args`.

export const SCOUT_LANE_PRIOR_UPDATE_CONFIG = {
  lanePriors: {
    bucket: "scout-prod",
    queueIds: [400, 420, 440, 480, 490],
    trainingStartDate: "2026-05-06",
    trainingEndDate: "2026-05-13",
    holdoutStartDate: "2026-05-14",
    holdoutEndDate: "2026-05-16",
    holdoutSampleSize: 100,
    holdoutSeed: "scout-lane-priors-patch-cadence-v1",
    threshold: 0.95,
  },
};

export const HOMELAB_AUDIT_AGENT_TASK: AgentTaskInput = {
  title: "Daily homelab health audit",
  provider: "claude",
  mode: "report-only",
  repo: {
    fullName: "shepherdjerred/monorepo",
    ref: "main",
  },
  scheduleId: "homelab-audit-daily",
  allowSelfCancel: false,
  // 8 was too low — Bugsink showed error_max_turns at ~9 turns on full audits.
  maxTurns: 40,
  // Bounded report still needs headroom for tool rounds + Postal render.
  agentTimeoutMinutes: 45,
  emailSubjectPrefix: "Homelab Audit",
  source: {
    docPath: "packages/docs/guides/2026-04-04_homelab-audit-runbook.md",
  },
  prompt: [
    "Run a bounded daily homelab health check. The runbook at",
    "`packages/docs/guides/2026-04-04_homelab-audit-runbook.md` is command reference only;",
    "do not execute the full runbook or build the full application matrix.",
    "Use live read-only evidence from the cluster and observability tools.",
    "Do not mutate Kubernetes, GitHub, PagerDuty, Grafana, Bugsink, Cloudflare, files, or git state.",
    "Ignore Bugsink entirely for this daily report.",
    "Finish in 5-10 minutes. Use narrow commands only, and wrap slow shell commands with timeout",
    "when available, usually 30-60 seconds. Do not run broad Loki scans, full app inventories,",
    "or exhaustive historical sweeps.",
    "Check exactly these areas: firing Prometheus alerts, open PagerDuty incidents, failed/stuck",
    "Temporal workflows and schedules, unhealthy Kubernetes pods/workloads, ArgoCD degraded or",
    "sync-error apps, and Buildkite main failures.",
    "Emit progress markers in the report for each area as Checked, Skipped, or Failed so the",
    "next timeout shows the last completed category. If a tool is slow, skip it and return a",
    "partial report instead of continuing.",
    "Return concise markdown suitable for email with current status, notable regressions,",
    "remaining action items, and exact evidence commands where useful.",
  ].join(" "),
};
