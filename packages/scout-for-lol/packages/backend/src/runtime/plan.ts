/**
 * What a runtime role starts, and in what order.
 *
 * The two functions here are the whole ordering contract, derived from the
 * capability table and from nothing else. They are pure so the order can be
 * asserted per role without standing up a Temporal connection, a Discord shard
 * or a listening socket — the previous startup test could only prove the single
 * combined ordering, and only by injecting fakes for the four steps it knew
 * about.
 *
 * ## Boot order
 *
 * The ordering constraints that survive the split:
 *
 * - Asset verification is first because its entire purpose is to crash the pod
 *   before it can be reached in a state where it renders broken output.
 * - Voice model verification is fatal for the same reason and must land before
 *   the gateway connects, so a voice-enabled pod is never briefly reachable
 *   while half-deaf.
 * - The report lake is folded into a published build before anything serves
 *   queries from it. This one binds `application` as much as `combined`:
 *   serving DuckDB reads off a half-published build answers with the wrong
 *   data rather than failing.
 * - Temporal comes up before the gateway and before HTTP, because commands and
 *   tRPC mutations both start Workflows and a start rejected at boot is a user
 *   request that visibly failed.
 *
 * The constraint that does NOT survive is Discord-before-HTTP. It existed
 * because web-serving code read the live guild cache, so serving during connect
 * handed real members false NOT_FOUNDs; PR #2819 moved those reads onto the
 * `installed-guilds` / `bot-rest` ports, and this change removes the gateway
 * from the `application` role entirely. `application` therefore serves as soon
 * as its own dependencies are ready. `combined` keeps connecting first — it
 * still owns a shard, and it is what production runs.
 *
 * ## Shutdown order
 *
 * Unchanged from the single-pod drain, minus the steps a role does not have:
 * voice first (it aborts in-flight Realtime turns and stops audio capture, and
 * everything after it can take tens of seconds), then Temporal, then the
 * competition worker, then HTTP, then the gateway, then the config poller,
 * analytics and the database.
 */

import type { ScoutRuntimeCapabilities } from "#src/configuration/runtime-role.ts";

export const SCOUT_BOOT_STEPS = [
  "champion-assets",
  "voice-assistant",
  "report-lake",
  "temporal-core",
  "discord-gateway",
  "temporal-deferred-workers",
  "gateway-ready-reconciliation",
  "http-server",
  "competition-worker",
  "database-seeding",
] as const;

export type ScoutBootStep = (typeof SCOUT_BOOT_STEPS)[number];

export const SCOUT_SHUTDOWN_STEPS = [
  "voice-assistant",
  "temporal",
  "competition-worker",
  "http-server",
  "discord-gateway",
  "dynamic-config",
  "product-analytics",
  "database",
] as const;

export type ScoutShutdownStep = (typeof SCOUT_SHUTDOWN_STEPS)[number];

/**
 * Every role runs the Temporal supervisor and an HTTP listener, so those two
 * steps are unconditional. The supervisor may carry no workers at all (the
 * `gateway` role runs a Temporal client and no Activities), and the listener
 * may serve only probes and metrics — but there is no role with neither.
 */
export function scoutBootSteps(
  capabilities: ScoutRuntimeCapabilities,
): readonly ScoutBootStep[] {
  const steps: ScoutBootStep[] = [];
  if (capabilities.championAssets) steps.push("champion-assets");
  if (capabilities.voiceAssistant) steps.push("voice-assistant");
  if (capabilities.reportLakeFold) steps.push("report-lake");
  steps.push("temporal-core");
  if (capabilities.discordGateway) steps.push("discord-gateway");
  if (capabilities.deferredTemporalWorkers.length > 0) {
    steps.push("temporal-deferred-workers");
  }
  if (capabilities.gatewayReadyReconciliation) {
    steps.push("gateway-ready-reconciliation");
  }
  steps.push("http-server");
  if (capabilities.competitionActivityWorker) steps.push("competition-worker");
  if (capabilities.databaseSeeding) steps.push("database-seeding");
  return steps;
}

export function scoutShutdownSteps(
  capabilities: ScoutRuntimeCapabilities,
): readonly ScoutShutdownStep[] {
  const steps: ScoutShutdownStep[] = [];
  if (capabilities.voiceAssistant) steps.push("voice-assistant");
  steps.push("temporal");
  if (capabilities.competitionActivityWorker) steps.push("competition-worker");
  steps.push("http-server");
  if (capabilities.discordGateway) steps.push("discord-gateway");
  steps.push("dynamic-config", "product-analytics", "database");
  return steps;
}

/**
 * One action per step, exhaustively.
 *
 * A `Record` over the closed step union rather than an optional bag: the
 * composition root must supply an implementation for every step that exists,
 * so adding a step to the vocabulary is a type error at the one place that
 * knows how to perform it, instead of a silently skipped subsystem.
 */
export type ScoutBootActions = Readonly<
  Record<ScoutBootStep, () => Promise<void>>
>;

export type ScoutShutdownActions = Readonly<
  Record<ScoutShutdownStep, () => Promise<void>>
>;

export async function runScoutBootSteps(
  steps: readonly ScoutBootStep[],
  actions: ScoutBootActions,
): Promise<void> {
  for (const step of steps) {
    await actions[step]();
  }
}

export async function runScoutShutdownSteps(
  steps: readonly ScoutShutdownStep[],
  actions: ScoutShutdownActions,
): Promise<void> {
  for (const step of steps) {
    await actions[step]();
  }
}
