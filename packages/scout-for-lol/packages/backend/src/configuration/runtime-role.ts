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
 * - `combined` — everything in one process. Development only: it is the
 *   default when `SCOUT_RUNTIME_ROLE` is unset in dev, and what local
 *   development runs whenever it wants the Discord gateway. Any other
 *   environment refuses it, because a hosted pod running it would be a second
 *   gateway connection and a second report-lake publisher.
 * - `application` — the web surface: HTTP/tRPC/OAuth/SSE, the `workflow`,
 *   `interactive` and `lake` Temporal workers, and the DuckDB report lake. No
 *   gateway connection, so it serves as soon as it is up rather than waiting
 *   on a shard. It owns the report-lake volume and the database-sweeping
 *   metric collectors. Gatewayless local development runs it too.
 * - `gateway` — the Discord gateway connection: commands, guild lifecycle and
 *   the Hey Scout voice assistant. Voice is gateway-coupled by design (it reads
 *   an active voice connection's audio), which makes this role explicitly
 *   stateful and unsplittable from the shard. It runs no Temporal workers, only
 *   a Temporal client. Discord authoring reserves a persisted Explore run and
 *   waits for the interactive Activity's result. Beta declares no lake access;
 *   development and production keep their compatibility capability.
 * - `activity-worker` — the `realtime` and `background` Temporal activity
 *   workers plus the competition activity worker: Riot polling, ingestion,
 *   report rendering and Discord delivery over REST. No gateway connection.
 *
 * `gateway` and `activity-worker` serve health and metrics endpoints but not
 * the product's HTTP surface — see {@link ScoutRuntimeCapabilities.httpSurface}.
 */

import type { ScoutStage } from "@scout-for-lol/temporal";
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
   * Can read members' live voice state — which voice channel someone is in.
   *
   * Gateway-only, and not for a reason REST can route around: voice state
   * exists only as VOICE_STATE_UPDATE events on a shard. A REST guild-member
   * payload carries roles and a nickname and no voice channel at all, so on a
   * gatewayless process `member.voice.channelId` is null for everyone. Code
   * that moves people between voice channels reads that field to decide whom
   * to move, so without this capability it does not fail — it moves nobody and
   * reports success. Anything depending on it must refuse loudly instead.
   */
  readonly voiceStateAccess: boolean;
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
   *
   * The queues are not the only readers, so "runs a worker" is not the test.
   * Discord authoring hands off to interactive Activities. Every remaining
   * in-process reader is funnelled through
   * `reports/duckdb/lake.ts`, which asserts this capability at the read site —
   * the boot gate alone cannot protect a role that declares `false`, because
   * declaring `false` is what skips the gate.
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
   * Workers added once the `discord-gateway` boot step resolves.
   *
   * That step resolves when `client.login()` does, NOT on `clientReady`, so
   * these can start while discord.js is still filling the guild cache. Only
   * `combined` has any, and its realtime and background Activities tolerate
   * that because their one cache read, `getActiveServerIds()`, answers
   * "no filter" until the client is ready. A role that owns no gateway runs
   * these from the start (`activity-worker`) or never (`gateway`).
   */
  readonly deferredTemporalWorkers: readonly ScoutTemporalQueueClass[];
  /** Log into the Discord gateway and install the command/guild handlers. */
  readonly discordGateway: boolean;
  /**
   * Start one ingestion reconciliation after the `discord-gateway` boot step
   * resolves — on `login()`, not on `clientReady`.
   */
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
 * The hosted roles partition `combined` exactly: every queue and singleton
 * responsibility `combined` runs has one hosted owner, which the role tests
 * assert against the table rather than against a prose description.
 */
const SCOUT_RUNTIME_CAPABILITIES: Readonly<
  Record<ScoutRuntimeRole, ScoutRuntimeCapabilities>
> = {
  combined: {
    championAssets: true,
    voiceAssistant: true,
    voiceStateAccess: true,
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
    voiceStateAccess: false,
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
    voiceStateAccess: true,
    // The dev/prod compatibility topology retains lake access. Beta overrides
    // it below: Discord Explore and Dare authoring hand off to interactive
    // Activities, just as web and voice do, and gateway owns no lake reader.
    reportLakeAccess: true,
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
    voiceStateAccess: false,
    // Reads the lake (report runs, parlay generation, summoner-index
    // backfill) and writes its staging directories (match,
    // prematch and timeline ingest). It does NOT publish builds — see the
    // README for the shared-volume and single-publisher contract.
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
  // The Temporal stage rather than configuration's Environment (the same
  // three stages): configuration.ts imports this module.
  stage: ScoutStage = "dev",
): ScoutRuntimeCapabilities {
  const capabilities = SCOUT_RUNTIME_CAPABILITIES[role];
  // Beta's external versioned Worker Deployment owns Workflow tasks. Embedded
  // unversioned workers remain available to dev and the production migration.
  return stage === "beta"
    ? {
        ...capabilities,
        reportLakeAccess: role !== "gateway" && capabilities.reportLakeAccess,
        temporalWorkers: capabilities.temporalWorkers.filter(
          (queue) => queue !== "workflow",
        ),
        deferredTemporalWorkers: capabilities.deferredTemporalWorkers.filter(
          (queue) => queue !== "workflow",
        ),
      }
    : capabilities;
}

/**
 * Resolve `SCOUT_RUNTIME_ROLE` for this environment.
 *
 * Unset means `combined` in development and is refused anywhere else: every
 * hosted pod names its role in its manifest. `combined` itself is refused
 * outside development, and an unrecognised value always throws rather than
 * falling back. A hosted pod that silently became `combined` would put a
 * second gateway connection and a second report-lake writer into the cluster,
 * which is precisely the failure this vocabulary exists to make impossible.
 */
export function parseScoutRuntimeRole(
  raw: string | undefined,
  environment: "dev" | "beta" | "prod",
): ScoutRuntimeRole {
  if (raw === undefined || raw.length === 0) {
    if (environment === "dev") return "combined";
    throw new Error(
      `SCOUT_RUNTIME_ROLE must be set in ${environment}; expected one of: ${SCOUT_RUNTIME_ROLES.filter((role) => role !== "combined").join(", ")}`,
    );
  }
  const parsed = ScoutRuntimeRoleSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid SCOUT_RUNTIME_ROLE="${raw}", expected one of: ${SCOUT_RUNTIME_ROLES.join(", ")}`,
    );
  }
  if (environment !== "dev" && parsed.data === "combined") {
    throw new Error(
      `SCOUT_RUNTIME_ROLE="combined" is development-only; ${environment} runs the split roles`,
    );
  }
  return parsed.data;
}
