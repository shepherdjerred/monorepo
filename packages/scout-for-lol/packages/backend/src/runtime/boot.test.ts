import { describe, expect, test } from "vitest";
import {
  SCOUT_RUNTIME_ROLES,
  type ScoutRuntimeRole,
} from "#src/configuration/runtime-role.ts";
import { startScoutRuntime } from "#src/runtime/boot.ts";
import type {
  ScoutBootActions,
  ScoutBootStep,
  ScoutShutdownActions,
  ScoutShutdownStep,
} from "#src/runtime/plan.ts";

/**
 * A whole runtime with every subsystem replaced by a recorder.
 *
 * The point of these tests is the composition root, not the subsystems: what
 * must be provable is that a role starts exactly what its capability table
 * declares and nothing else. So the actions are named recorders, and the
 * assertions are about the recording — no Temporal connection, no Discord
 * shard, no listening socket, no DuckDB.
 */
type RuntimeTranscript = {
  readonly boot: ScoutBootStep[];
  readonly shutdown: ScoutShutdownStep[];
  readonly discord: string[];
  readonly metricSweeps: boolean[];
};

function transcript(): RuntimeTranscript {
  return { boot: [], shutdown: [], discord: [], metricSweeps: [] };
}

function bootActions(log: ScoutBootStep[]): ScoutBootActions {
  const record = (step: ScoutBootStep) => () => {
    log.push(step);
    return Promise.resolve();
  };
  return {
    "champion-assets": record("champion-assets"),
    "voice-assistant": record("voice-assistant"),
    "report-lake": record("report-lake"),
    "temporal-core": record("temporal-core"),
    "discord-gateway": record("discord-gateway"),
    "temporal-deferred-workers": record("temporal-deferred-workers"),
    "gateway-ready-reconciliation": record("gateway-ready-reconciliation"),
    "http-server": record("http-server"),
    "competition-worker": record("competition-worker"),
    "database-seeding": record("database-seeding"),
  };
}

function shutdownActions(log: ScoutShutdownStep[]): ScoutShutdownActions {
  const record = (step: ScoutShutdownStep) => () => {
    log.push(step);
    return Promise.resolve();
  };
  return {
    "voice-assistant": record("voice-assistant"),
    temporal: record("temporal"),
    "competition-worker": record("competition-worker"),
    "http-server": record("http-server"),
    "discord-gateway": record("discord-gateway"),
    "dynamic-config": record("dynamic-config"),
    "product-analytics": record("product-analytics"),
    database: record("database"),
  };
}

async function boot(role: ScoutRuntimeRole): Promise<RuntimeTranscript> {
  const log = transcript();
  const runtime = await startScoutRuntime(role, {
    configureMetricSweeps: (enabled) => log.metricSweeps.push(enabled),
    prepareDiscord: ({ ownsGateway }) => {
      // The production implementation always authorizes REST, and additionally
      // marks the gateway deliberately absent when this role owns no shard.
      log.discord.push("rest-token");
      if (!ownsGateway) log.discord.push("gateway-marked-disabled");
      return Promise.resolve();
    },
    boot: bootActions(log.boot),
    shutdown: shutdownActions(log.shutdown),
  });
  await runtime.shutdown();
  return log;
}

describe("scout runtime boot", () => {
  test("combined runs every subsystem, in the pre-role order", async () => {
    const log = await boot("combined");
    expect(log.boot).toEqual([
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
    ]);
    expect(log.shutdown).toEqual([
      "voice-assistant",
      "temporal",
      "competition-worker",
      "http-server",
      "discord-gateway",
      "dynamic-config",
      "product-analytics",
      "database",
    ]);
  });

  test("application boots with a REST token and no gateway login", async () => {
    const log = await boot("application");
    expect(log.boot).toEqual([
      "champion-assets",
      "report-lake",
      "temporal-core",
      "http-server",
      "database-seeding",
    ]);
    // The bot token is used, but only to authorize REST — never to open a
    // shard.
    expect(log.discord).toEqual(["rest-token", "gateway-marked-disabled"]);
    expect(log.boot).not.toContain("discord-gateway");
  });

  test("gateway boots without the product HTTP surface or the lake", async () => {
    const log = await boot("gateway");
    expect(log.boot).toEqual([
      "champion-assets",
      "voice-assistant",
      "temporal-core",
      "discord-gateway",
      "gateway-ready-reconciliation",
      "http-server",
    ]);
    // It logs in, so it must not pre-mark its own gateway as disabled.
    expect(log.discord).toEqual(["rest-token"]);
    expect(log.boot).not.toContain("report-lake");
    expect(log.boot).not.toContain("database-seeding");
  });

  test("activity-worker starts exactly its workers", async () => {
    const log = await boot("activity-worker");
    expect(log.boot).toEqual([
      "champion-assets",
      "temporal-core",
      "http-server",
      "competition-worker",
    ]);
    expect(log.discord).toEqual(["rest-token", "gateway-marked-disabled"]);
    expect(log.shutdown).toEqual([
      "temporal",
      "competition-worker",
      "http-server",
      "dynamic-config",
      "product-analytics",
      "database",
    ]);
  });

  test("every gatewayless role marks its absent gateway before serving", async () => {
    // Without this the gateway health singleton stays at its initial
    // `connecting`, and `/livez` fails the pod once the five-minute startup
    // grace period ends — a crash loop, not a degraded feature.
    for (const role of SCOUT_RUNTIME_ROLES) {
      const log = await boot(role);
      const ownsGateway = log.boot.includes("discord-gateway");
      expect(log.discord.includes("gateway-marked-disabled")).toBe(
        !ownsGateway,
      );
    }
  });

  test("exactly one role composes the database-sweeping collectors", async () => {
    const sweepers: ScoutRuntimeRole[] = [];
    for (const role of SCOUT_RUNTIME_ROLES) {
      const log = await boot(role);
      expect(log.metricSweeps).toHaveLength(1);
      if (log.metricSweeps[0] === true) sweepers.push(role);
    }
    expect(sweepers).toEqual(["combined", "application"]);
  });

  test("the metric decision is made before any subsystem starts", async () => {
    // A scrape can land during boot; the registry must already be composed for
    // this role when it does.
    const order: string[] = [];
    const log = transcript();
    const runtime = await startScoutRuntime("application", {
      configureMetricSweeps: () => order.push("metrics"),
      prepareDiscord: () => {
        order.push("discord");
        return Promise.resolve();
      },
      boot: {
        ...bootActions(log.boot),
        "champion-assets": () => {
          order.push("first-step");
          return Promise.resolve();
        },
      },
      shutdown: shutdownActions(log.shutdown),
    });
    await runtime.shutdown();
    expect(order).toEqual(["metrics", "discord", "first-step"]);
  });
});
