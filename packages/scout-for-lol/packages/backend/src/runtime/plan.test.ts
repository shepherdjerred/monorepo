import { describe, expect, test } from "vitest";
import {
  scoutRuntimeCapabilities,
  SCOUT_RUNTIME_ROLES,
} from "#src/configuration/runtime-role.ts";
import { scoutBootSteps, scoutShutdownSteps } from "#src/runtime/plan.ts";

function bootStepsFor(role: Parameters<typeof scoutRuntimeCapabilities>[0]) {
  return scoutBootSteps(scoutRuntimeCapabilities(role));
}

function shutdownStepsFor(
  role: Parameters<typeof scoutRuntimeCapabilities>[0],
) {
  return scoutShutdownSteps(scoutRuntimeCapabilities(role));
}

describe("runtime boot order", () => {
  test("combined boots exactly as the single-pod deployment always has", () => {
    // Transcribed from the pre-role `startup.ts` / `index.ts` sequence. This is
    // the row that production runs, so a change here is a change to the live
    // system rather than to a new role.
    expect(bootStepsFor("combined")).toEqual([
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
  });

  test("application serves without ever touching the gateway", () => {
    const steps = bootStepsFor("application");
    expect(steps).toEqual([
      "champion-assets",
      "report-lake",
      "temporal-core",
      "http-server",
      "database-seeding",
    ]);
    // The Discord-before-HTTP ordering existed because web code read the live
    // guild cache. Those reads now go through the installed-guilds/bot-rest
    // ports, and this role has no shard to wait for at all.
    expect(steps).not.toContain("discord-gateway");
    expect(steps).not.toContain("voice-assistant");
  });

  test("gateway boots the shard and voice, and nothing that owns data", () => {
    const steps = bootStepsFor("gateway");
    expect(steps).toEqual([
      "champion-assets",
      "voice-assistant",
      "report-lake",
      "temporal-core",
      "discord-gateway",
      "gateway-ready-reconciliation",
      "http-server",
    ]);
    // Voice verification is fatal and must land before the shard connects, so
    // a voice-enabled pod is never briefly reachable while half-deaf.
    expect(steps.indexOf("voice-assistant")).toBeLessThan(
      steps.indexOf("discord-gateway"),
    );
    // The lake is settled before the shard connects too: this role answers
    // `/scout ask` and the Dare commands from the lake, in process, as soon as
    // the first interaction arrives.
    expect(steps.indexOf("report-lake")).toBeLessThan(
      steps.indexOf("discord-gateway"),
    );
    expect(steps).not.toContain("database-seeding");
  });

  test("activity-worker starts its workers and the competition worker only", () => {
    const steps = bootStepsFor("activity-worker");
    expect(steps).toEqual([
      "champion-assets",
      "report-lake",
      "temporal-core",
      "http-server",
      "competition-worker",
    ]);
    // Its realtime and background workers need no gateway, so they come up with
    // the supervisor rather than waiting for a `clientReady` that never fires.
    expect(steps).not.toContain("temporal-deferred-workers");
    expect(steps).not.toContain("discord-gateway");
  });

  test("every role brings up Temporal and an HTTP listener", () => {
    for (const role of SCOUT_RUNTIME_ROLES) {
      const steps = bootStepsFor(role);
      expect(steps).toContain("temporal-core");
      expect(steps).toContain("http-server");
      expect(steps.indexOf("temporal-core")).toBeLessThan(
        steps.indexOf("http-server"),
      );
    }
  });

  test("asset verification is always first", () => {
    for (const role of SCOUT_RUNTIME_ROLES) {
      expect(bootStepsFor(role)[0]).toBe("champion-assets");
    }
  });

  test("the lake is settled before anything queries it", () => {
    // Before HTTP accepts traffic AND before the Temporal workers start
    // polling: an unpublished lake does not fail a DuckDB query, it answers it
    // with nothing, so both readers have to be held back.
    for (const role of SCOUT_RUNTIME_ROLES) {
      const steps = bootStepsFor(role);
      if (!steps.includes("report-lake")) continue;
      expect(steps.indexOf("report-lake")).toBeLessThan(
        steps.indexOf("http-server"),
      );
      expect(steps.indexOf("report-lake")).toBeLessThan(
        steps.indexOf("temporal-core"),
      );
    }
  });

  test("every role that runs a Temporal worker settles the lake first", () => {
    for (const role of SCOUT_RUNTIME_ROLES) {
      const capabilities = scoutRuntimeCapabilities(role);
      const runsWorkers =
        capabilities.temporalWorkers.length > 0 ||
        capabilities.deferredTemporalWorkers.length > 0;
      if (!runsWorkers) continue;
      expect(bootStepsFor(role)).toContain("report-lake");
    }
  });

  test("no step is scheduled twice", () => {
    for (const role of SCOUT_RUNTIME_ROLES) {
      const steps = bootStepsFor(role);
      expect(new Set(steps).size).toBe(steps.length);
    }
  });
});

describe("runtime shutdown order", () => {
  test("combined drains exactly as the single-pod deployment always has", () => {
    expect(shutdownStepsFor("combined")).toEqual([
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

  test("application drains without gateway or voice steps", () => {
    expect(shutdownStepsFor("application")).toEqual([
      "temporal",
      "http-server",
      "dynamic-config",
      "product-analytics",
      "database",
    ]);
  });

  test("gateway drains voice before Temporal", () => {
    const steps = shutdownStepsFor("gateway");
    expect(steps).toEqual([
      "voice-assistant",
      "temporal",
      "http-server",
      "discord-gateway",
      "dynamic-config",
      "product-analytics",
      "database",
    ]);
    // Voice first: a Temporal drain plus an HTTP drain is long enough that a
    // session would otherwise keep receiving audio and running OpenAI turns
    // through the whole sequence.
    expect(steps.indexOf("voice-assistant")).toBeLessThan(
      steps.indexOf("temporal"),
    );
  });

  test("activity-worker drains both of its workers", () => {
    expect(shutdownStepsFor("activity-worker")).toEqual([
      "temporal",
      "competition-worker",
      "http-server",
      "dynamic-config",
      "product-analytics",
      "database",
    ]);
  });

  test("every role stops the config poller before analytics and the database", () => {
    for (const role of SCOUT_RUNTIME_ROLES) {
      const steps = shutdownStepsFor(role);
      expect(steps.indexOf("dynamic-config")).toBeLessThan(
        steps.indexOf("product-analytics"),
      );
      expect(steps.at(-1)).toBe("database");
    }
  });

  test("a role shuts down every subsystem it starts", () => {
    for (const role of SCOUT_RUNTIME_ROLES) {
      const boot = bootStepsFor(role);
      const shutdown = shutdownStepsFor(role);
      for (const step of ["voice-assistant", "competition-worker"] as const) {
        expect(shutdown.includes(step)).toBe(boot.includes(step));
      }
      expect(shutdown.includes("discord-gateway")).toBe(
        boot.includes("discord-gateway"),
      );
    }
  });
});
