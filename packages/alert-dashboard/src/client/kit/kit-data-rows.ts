import type { Severity, TimelineItem } from "@shepherdjerred/console-ui";

/** One signal row of the gallery's long table; nothing here is live data. */
export type KitSignal = {
  readonly id: string;
  readonly name: string;
  readonly severity: Severity;
  readonly status: string;
  readonly service: string;
  readonly trend: readonly number[];
  readonly budget: number;
  readonly firingMinutes: number | null;
  readonly count: number;
  readonly silenced: boolean;
};

const SERVICES = [
  "hub",
  "delivery",
  "tracker",
  "temporal-worker",
  "postgres",
  "seaweedfs",
  "argocd",
  "mail",
] as const;

const CHECKS = [
  "Pod restarts",
  "Error budget burn",
  "Queue depth",
  "Disk pressure",
  "Latency p99",
  "Backup age",
  "Certificate expiry",
  "Replication lag",
] as const;

const SEVERITY_BY_ROLL: readonly Severity[] = [
  "ok",
  "ok",
  "ok",
  "info",
  "ok",
  "warning",
  "ok",
  "unknown",
  "ok",
  "warning",
  "error",
  "ok",
];

const STATUS: Readonly<Record<Severity, string>> = {
  ok: "Healthy",
  info: "Notice",
  unknown: "No data",
  warning: "Degraded",
  error: "Firing",
};

/** A small deterministic generator, so screenshots stay the same. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

/** Three hundred realistic signals across eight services. */
export function kitSignals(count = 300): KitSignal[] {
  const next = seeded(42);
  return Array.from({ length: count }, (_, index) => {
    const service = SERVICES[index % SERVICES.length] ?? "hub";
    const check = CHECKS[Math.floor(index / SERVICES.length) % CHECKS.length];
    const severity =
      SEVERITY_BY_ROLL[Math.floor(next() * SEVERITY_BY_ROLL.length)] ?? "ok";
    const base = 20 + next() * 60;
    return {
      id: `sig-${String(index + 1).padStart(3, "0")}`,
      name: `${check ?? "Check"} ${String(Math.floor(index / 64) + 1)}`,
      severity,
      status: STATUS[severity],
      service,
      trend: Array.from({ length: 12 }, () =>
        Math.round(base + (next() - 0.5) * 30),
      ),
      budget: Math.round(next() * (severity === "error" ? 130 : 95)),
      firingMinutes:
        severity === "ok" || severity === "info"
          ? null
          : Math.round(next() * 600),
      count: Math.floor(next() * 40),
      silenced: index % 9 === 0,
    };
  });
}

/** "3h 12m" or "45m". */
export function minutesText(minutes: number | null): string {
  if (minutes === null) {
    return "—";
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours === 0
    ? `${String(rest)}m`
    : `${String(hours)}h ${String(rest).padStart(2, "0")}m`;
}

/** A fixed "now" so the gallery's day headings never move. */
export const KIT_NOW = "2026-11-26T22:00:00Z";

export const KIT_TIMELINE: readonly TimelineItem[] = [
  {
    id: "t1",
    when: "2026-11-26T21:52:00Z",
    title: "hub v412 deployed",
    detail: "Rolled out to 3 pods in 2m 14s",
    severity: "ok",
    actor: "delivery",
    meta: "commit 6a91de8",
  },
  {
    id: "t2",
    when: "2026-11-26T21:31:00Z",
    title: "KubePodCrashLooping fired",
    detail: "temporal-worker restarted 3 times in 10 minutes",
    severity: "error",
    actor: "alertmanager",
  },
  {
    id: "t3",
    when: "2026-11-26T19:05:00Z",
    title: "Silence added for seaweedfs disk pressure",
    severity: "info",
    actor: "jerred",
    meta: "ends in 4h",
  },
  {
    id: "t4",
    when: "2026-11-25T23:40:00Z",
    title: "Backup verification degraded",
    detail: "Offsite copy is 29h old; the SLA is 24h",
    severity: "warning",
    actor: "velero",
  },
  {
    id: "t5",
    when: "2026-11-25T17:12:00Z",
    title: "Note added to SJ-212",
    actor: "jerred",
  },
  {
    id: "t6",
    when: "2026-11-22T08:00:00Z",
    title: "Weekly report sent",
    severity: "ok",
    meta: "12 recipients",
  },
];

export const KIT_STEPS: readonly TimelineItem[] = [
  {
    id: "s1",
    when: "2026-11-26T21:49:46Z",
    whenText: "0:00",
    title: "Build image",
    severity: "ok",
    meta: "48s",
  },
  {
    id: "s2",
    when: "2026-11-26T21:50:34Z",
    whenText: "0:48",
    title: "Push to registry",
    severity: "ok",
    meta: "12s",
  },
  {
    id: "s3",
    when: "2026-11-26T21:50:46Z",
    whenText: "1:00",
    title: "Argo sync",
    severity: "warning",
    detail: "Retried once: webhook timed out",
    meta: "1m 2s",
  },
  {
    id: "s4",
    when: "2026-11-26T21:51:48Z",
    whenText: "2:02",
    title: "Smoke test",
    severity: "unknown",
    meta: "queued",
  },
];
