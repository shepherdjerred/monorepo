/**
 * The closed set of shapes one Scout backend image can boot into, and exactly
 * which subsystems each one starts.
 *
 * One image, four roles, selected by `SCOUT_RUNTIME_ROLE` at startup. The point
 * of writing them as a table rather than as branches at each call site is that
 * the set of subsystems a pod runs is then a value that can be read, printed
 * and asserted — a role cannot half-configure a pod by forgetting a branch,
 * because there are no branches to forget.
 *
 * This module is a leaf on purpose (it imports nothing but Zod). The table is
 * the vocabulary; `src/runtime/` is what acts on it.
 *
 * ## The roles
 *
 * - `combined` — everything, in the order the single-pod deployment has always
 *   booted it. This is the default and the only role Kubernetes runs today;
 *   splitting the deployment is a separate change. Local development uses it
 *   whenever it wants the Discord gateway.
 * - `application` — the web surface: HTTP/tRPC/OAuth/SSE, the `interactive` and
 *   `lake` Temporal workers, and the DuckDB report lake. No gateway
 *   connection, so it serves as soon as it is up rather than waiting on a
 *   shard. It owns the report-lake volume and the database-sweeping metric
 *   collectors.
 * - `gateway` — the Discord gateway connection: commands, guild lifecycle and
 *   the Hey Scout voice assistant. Voice is gateway-coupled by design (it reads
 *   an active voice connection's audio), which makes this role explicitly
 *   stateful and unsplittable from the shard. It runs no Temporal workers, only
 *   a Temporal client, because commands start Workflows they do not execute.
 * - `activity-worker` — the `realtime` and `background` Temporal activity
 *   workers plus the competition activity worker: Riot polling, ingestion,
 *   report rendering and Discord delivery over REST. No gateway connection.
 *
 * `gateway` and `activity-worker` serve health and metrics endpoints but not
 * the product's HTTP surface — see {@link ScoutRuntimeCapabilities.httpSurface}.
 */

import { z } from "zod";

export const ScoutRuntimeRoleSchema = z.enum([
  "combined",
  "application",
  "gateway",
  "activity-worker",
]);

export type ScoutRuntimeRole = z.infer<typeof ScoutRuntimeRoleSchema>;

export const SCOUT_RUNTIME_ROLES: readonly ScoutRuntimeRole[] =
  ScoutRuntimeRoleSchema.options;

/**
 * The embedded Temporal workers, named by the task queue each one polls.
 *
 * `workflow` runs Workflow code; the other four run Activities. The externally
 * deployed stable/candidate Workflow Workers poll the same `workflow` queue and
 * are unaffected by any of this.
 */
export const SCOUT_TEMPORAL_QUEUE_CLASSES = [
  "workflow",
  "interactive",
  "lake",
  "realtime",
  "background",
] as const;

export type ScoutTemporalQueueClass =
  (typeof SCOUT_TEMPORAL_QUEUE_CLASSES)[number];

/**
 * How much of the HTTP surface a role serves.
 *
 * `admin` is `/ping`, `/livez`, `/healthz` and `/metrics` — every role is
 * scrapable and probeable. `full` adds the product surface: tRPC, OAuth, the
 * Explore SSE stream, image rendering and the Discord Activity socket.
 */
export type ScoutHttpSurface = "full" | "admin";

export type ScoutRuntimeCapabilities = {
  /**
   * Verify the bundled Data Dragon champion images before serving. True for
   * every role: all four render champion-bearing output (reports, command
   * embeds, `/api/image/*`), and the check is a local file sweep whose whole
   * job is to crash the pod at boot rather than at notification time.
   */
  readonly championAssets: boolean;
  /** Verify the pinned voice models and load the Realtime credential. */
  readonly voiceAssistant: boolean;
  /**
   * Needs the DuckDB report-lake directory mounted and holding a published
   * build.
   *
   * Wider than {@link reportLakeFold}, and the wider one is what decides
   * whether a pod can do its job: EVERY embedded Temporal activity queue reads
   * the lake somewhere. `realtime` reads it settling SQL dares and evaluating
   * hall progression, `interactive` reads it for every Explore query,
   * `background` reads it for report runs, parlay generation and the weekly
   * parlay, and `lake` is the compactor itself. A worker role pointed at an
   * empty directory does not fail — DuckDB happily scans zero parquet files —
   * so it records empty query results as successful runs. That is why this is a
   * declared capability with a boot gate rather than an assumption.
   */
  readonly reportLakeAccess: boolean;
  /**
   * Fold the lake into a published build at boot, and own the `lake` worker
   * that republishes it. Exactly one role: two processes publishing builds onto
   * one volume would race each other's `CURRENT` pointer.
   */
  readonly reportLakeFold: boolean;
  /** Workers started as soon as Temporal connects. */
  readonly temporalWorkers: readonly ScoutTemporalQueueClass[];
  /**
   * Workers added once the Discord gateway is ready.
   *
   * Only `combined` has any: its realtime and background Activities read the
   * live guild cache, so starting them before `clientReady` would poll with a
   * cache that cannot yet answer. A role that owns no gateway either runs these
   * from the start (`activity-worker`) or never (`application`, `gateway`).
   */
  readonly deferredTemporalWorkers: readonly ScoutTemporalQueueClass[];
  /** Log into the Discord gateway and install the command/guild handlers. */
  readonly discordGateway: boolean;
  /** Start one ingestion reconciliation once the gateway is ready. */
  readonly gatewayReadyReconciliation: boolean;
  readonly httpSurface: ScoutHttpSurface;
  /** The activity worker for scheduled competition updates. */
  readonly competitionActivityWorker: boolean;
  /**
   * Own the metric collectors that sweep the database on every `/metrics`
   * scrape. Exactly one role does, so N pods do not turn one scrape into N
   * full sweeps of the same tables.
   */
  readonly databaseMetricSweeps: boolean;
  /** Seed the Season table and the scheduled-report freshness gauge at boot. */
  readonly databaseSeeding: boolean;
};

const ALWAYS_ON_WORKERS: readonly ScoutTemporalQueueClass[] = [
  "workflow",
  "interactive",
  "lake",
];

const DISCORD_WORKERS: readonly ScoutTemporalQueueClass[] = [
  "realtime",
  "background",
];

const NO_WORKERS: readonly ScoutTemporalQueueClass[] = [];

/**
 * The whole split, in one place.
 *
 * `combined` must stay byte-for-byte equivalent to the pre-role behaviour: it
 * is what production runs, and the role tests assert the rest of the table
 * against it rather than against a prose description.
 */
const SCOUT_RUNTIME_CAPABILITIES: Readonly<
  Record<ScoutRuntimeRole, ScoutRuntimeCapabilities>
> = {
  combined: {
    championAssets: true,
    voiceAssistant: true,
    reportLakeAccess: true,
    reportLakeFold: true,
    temporalWorkers: ALWAYS_ON_WORKERS,
    deferredTemporalWorkers: DISCORD_WORKERS,
    discordGateway: true,
    gatewayReadyReconciliation: true,
    httpSurface: "full",
    competitionActivityWorker: true,
    databaseMetricSweeps: true,
    databaseSeeding: true,
  },
  application: {
    championAssets: true,
    voiceAssistant: false,
    reportLakeAccess: true,
    reportLakeFold: true,
    temporalWorkers: ALWAYS_ON_WORKERS,
    deferredTemporalWorkers: NO_WORKERS,
    discordGateway: false,
    gatewayReadyReconciliation: false,
    httpSurface: "full",
    competitionActivityWorker: false,
    databaseMetricSweeps: true,
    databaseSeeding: true,
  },
  gateway: {
    championAssets: true,
    voiceAssistant: true,
    // The only role that runs no activity queue, and therefore the only one
    // that needs no lake volume at all.
    reportLakeAccess: false,
    reportLakeFold: false,
    temporalWorkers: NO_WORKERS,
    deferredTemporalWorkers: NO_WORKERS,
    discordGateway: true,
    gatewayReadyReconciliation: true,
    httpSurface: "admin",
    competitionActivityWorker: false,
    databaseMetricSweeps: false,
    databaseSeeding: false,
  },
  "activity-worker": {
    championAssets: true,
    voiceAssistant: false,
    // Reads the lake (report runs, parlay generation, the weekly parlay,
    // summoner-index backfill) and writes its staging directories (match,
    // prematch and timeline ingest). It does NOT publish builds — see the
    // README for why that makes this role undeployable beside `application` on
    // the current ReadWriteOnce volume.
    reportLakeAccess: true,
    reportLakeFold: false,
    temporalWorkers: DISCORD_WORKERS,
    deferredTemporalWorkers: NO_WORKERS,
    discordGateway: false,
    gatewayReadyReconciliation: false,
    httpSurface: "admin",
    competitionActivityWorker: true,
    databaseMetricSweeps: false,
    databaseSeeding: false,
  },
};

export function scoutRuntimeCapabilities(
  role: ScoutRuntimeRole,
): ScoutRuntimeCapabilities {
  return SCOUT_RUNTIME_CAPABILITIES[role];
}

/**
 * Resolve `SCOUT_RUNTIME_ROLE`, defaulting to `combined`.
 *
 * An unrecognised value throws rather than falling back: a typo'd role in a
 * Deployment manifest that silently became `combined` would put a second
 * gateway connection and a second report-lake writer into the cluster, which is
 * precisely the failure this vocabulary exists to make impossible.
 */
export function parseScoutRuntimeRole(
  raw: string | undefined,
): ScoutRuntimeRole {
  if (raw === undefined || raw.length === 0) return "combined";
  const parsed = ScoutRuntimeRoleSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new Error(
    `Invalid SCOUT_RUNTIME_ROLE="${raw}", expected one of: ${SCOUT_RUNTIME_ROLES.join(", ")}`,
  );
}
