import { describe, expect, test } from "vitest";
import {
  parseScoutRuntimeRole,
  scoutRuntimeCapabilities,
  SCOUT_RUNTIME_ROLES,
  SCOUT_TEMPORAL_QUEUE_CLASSES,
  type ScoutRuntimeCapabilities,
  type ScoutRuntimeRole,
} from "#src/configuration/runtime-role.ts";

/**
 * The capability table written out a second time, by hand.
 *
 * A test that asked `scoutRuntimeCapabilities(role)` what a role does and then
 * asserted that answer against itself would pass for any table. Restating the
 * intended split independently is what makes an accidental edit — a subsystem
 * silently gaining a role, or the `combined` row drifting from the behaviour
 * production runs — fail here instead of in beta.
 */
const EXPECTED: Readonly<Record<ScoutRuntimeRole, ScoutRuntimeCapabilities>> = {
  combined: {
    championAssets: true,
    voiceAssistant: true,
    reportLakeFold: true,
    temporalWorkers: ["workflow", "interactive", "lake"],
    deferredTemporalWorkers: ["realtime", "background"],
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
    reportLakeFold: true,
    temporalWorkers: ["workflow", "interactive", "lake"],
    deferredTemporalWorkers: [],
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
    reportLakeFold: false,
    temporalWorkers: [],
    deferredTemporalWorkers: [],
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
    reportLakeFold: false,
    temporalWorkers: ["realtime", "background"],
    deferredTemporalWorkers: [],
    discordGateway: false,
    gatewayReadyReconciliation: false,
    httpSurface: "admin",
    competitionActivityWorker: true,
    databaseMetricSweeps: false,
    databaseSeeding: false,
  },
};

/** Every role except `combined`, which is the un-split shape by definition. */
const SPLIT_ROLES = SCOUT_RUNTIME_ROLES.filter((role) => role !== "combined");

/** Which split roles declare a given capability. */
function splitRolesWith(
  predicate: (capabilities: ScoutRuntimeCapabilities) => boolean,
): ScoutRuntimeRole[] {
  return SPLIT_ROLES.filter((role) =>
    predicate(scoutRuntimeCapabilities(role)),
  );
}

describe("scout runtime roles", () => {
  test.each(SCOUT_RUNTIME_ROLES)("%s declares its exact subsystems", (role) => {
    expect(scoutRuntimeCapabilities(role)).toEqual(EXPECTED[role]);
  });

  test("the vocabulary is exactly the four deployable shapes", () => {
    expect([...SCOUT_RUNTIME_ROLES]).toEqual([
      "combined",
      "application",
      "gateway",
      "activity-worker",
    ]);
  });

  test("every worker runs on exactly one non-combined role", () => {
    // The split has to be a partition, not an overlap: two pods polling the
    // same activity queue would double every Riot poll and every delivery, and
    // a queue nobody polls is work that silently never happens.
    for (const queueClass of SCOUT_TEMPORAL_QUEUE_CLASSES) {
      const owners = SPLIT_ROLES.filter((role) => {
        const capabilities = scoutRuntimeCapabilities(role);
        return (
          capabilities.temporalWorkers.includes(queueClass) ||
          capabilities.deferredTemporalWorkers.includes(queueClass)
        );
      });
      expect(owners).toHaveLength(1);
    }
  });

  test("the split covers every worker combined runs", () => {
    const combined = scoutRuntimeCapabilities("combined");
    const combinedQueues = new Set([
      ...combined.temporalWorkers,
      ...combined.deferredTemporalWorkers,
    ]);
    const split = new Set(
      SPLIT_ROLES.flatMap((role) => [
        ...scoutRuntimeCapabilities(role).temporalWorkers,
        ...scoutRuntimeCapabilities(role).deferredTemporalWorkers,
      ]),
    );
    expect([...split].toSorted()).toEqual([...combinedQueues].toSorted());
  });

  test("exactly one split role owns each singleton responsibility", () => {
    // A second gateway connection means duplicate command handling and
    // duplicate guild-lifecycle writes; a second report-lake writer means two
    // processes publishing builds onto one ReadWriteOnce volume; a second
    // metric sweeper multiplies one Prometheus scrape into N table sweeps.
    const owners = splitRolesWith;

    expect(owners((c) => c.discordGateway)).toEqual(["gateway"]);
    expect(owners((c) => c.voiceAssistant)).toEqual(["gateway"]);
    expect(owners((c) => c.reportLakeFold)).toEqual(["application"]);
    expect(owners((c) => c.databaseMetricSweeps)).toEqual(["application"]);
    expect(owners((c) => c.databaseSeeding)).toEqual(["application"]);
    expect(owners((c) => c.httpSurface === "full")).toEqual(["application"]);
    expect(owners((c) => c.competitionActivityWorker)).toEqual([
      "activity-worker",
    ]);
    expect(owners((c) => c.gatewayReadyReconciliation)).toEqual(["gateway"]);
  });

  test("only the gateway-owning role defers workers", () => {
    for (const role of SCOUT_RUNTIME_ROLES) {
      const capabilities = scoutRuntimeCapabilities(role);
      if (capabilities.deferredTemporalWorkers.length === 0) continue;
      expect(capabilities.discordGateway).toBe(true);
    }
  });

  test("every role is probeable and scrapable", () => {
    for (const role of SCOUT_RUNTIME_ROLES) {
      expect(["full", "admin"]).toContain(
        scoutRuntimeCapabilities(role).httpSurface,
      );
    }
  });
});

describe("runtime role parsing", () => {
  test("an unset role is the combined default", () => {
    expect(parseScoutRuntimeRole(undefined)).toBe("combined");
    expect(parseScoutRuntimeRole("")).toBe("combined");
  });

  test.each(SCOUT_RUNTIME_ROLES)("parses %s", (role) => {
    expect(parseScoutRuntimeRole(role)).toBe(role);
  });

  test("an unrecognised role throws and names the alternatives", () => {
    expect(() => parseScoutRuntimeRole("worker")).toThrow(
      /Invalid SCOUT_RUNTIME_ROLE="worker", expected one of: combined, application, gateway, activity-worker/,
    );
  });

  test("a near-miss is not silently coerced", () => {
    expect(() => parseScoutRuntimeRole("Combined")).toThrow();
    expect(() => parseScoutRuntimeRole("activity_worker")).toThrow();
  });
});
