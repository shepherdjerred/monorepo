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
 * silently gaining a role, or a hosted role drifting from the split — fail
 * here instead of in beta.
 */
const EXPECTED: Readonly<Record<ScoutRuntimeRole, ScoutRuntimeCapabilities>> = {
  combined: {
    championAssets: true,
    voiceAssistant: true,
    voiceStateAccess: true,
    reportLakeAccess: true,
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
    voiceStateAccess: false,
    reportLakeAccess: true,
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
    voiceStateAccess: true,
    // True with no Temporal queue of its own: `/scout ask` and the Dare
    // commands run the Explore agent in the process that received the
    // interaction, and that is this one.
    reportLakeAccess: true,
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
    voiceStateAccess: false,
    reportLakeAccess: true,
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

const SPLIT_ROLES: readonly ScoutRuntimeRole[] = [
  "application",
  "gateway",
  "activity-worker",
];

/** Which split roles declare a given capability. */
function splitRolesWith(
  predicate: (capabilities: ScoutRuntimeCapabilities) => boolean,
): ScoutRuntimeRole[] {
  return SPLIT_ROLES.filter((role) =>
    predicate(scoutRuntimeCapabilities(role)),
  );
}

describe("scout runtime roles", () => {
  test.each(SCOUT_RUNTIME_ROLES)(
    "beta %s leaves Workflow tasks to its versioned deployment",
    (role) => {
      const beta = scoutRuntimeCapabilities(role, "beta");
      expect([
        ...beta.temporalWorkers,
        ...beta.deferredTemporalWorkers,
      ]).not.toContain("workflow");
      expect(scoutRuntimeCapabilities(role, "prod")).toEqual(
        scoutRuntimeCapabilities(role, "dev"),
      );
    },
  );
  test("beta gateway cannot read the lake while its interactive worker can", () => {
    expect(scoutRuntimeCapabilities("gateway", "beta").reportLakeAccess).toBe(
      false,
    );
    expect(
      scoutRuntimeCapabilities("application", "beta").reportLakeAccess,
    ).toBe(true);
  });
  test.each(SCOUT_RUNTIME_ROLES)("%s declares its exact subsystems", (role) => {
    expect(scoutRuntimeCapabilities(role)).toEqual(EXPECTED[role]);
  });

  test("the vocabulary is combined plus the three hosted roles", () => {
    expect([...SCOUT_RUNTIME_ROLES]).toEqual([
      "combined",
      "application",
      "gateway",
      "activity-worker",
    ]);
  });

  /**
   * The split is a partition: a queue with no poller silently stalls, while
   * two role owners split work across processes and make rollback and
   * per-role health ambiguous.
   */
  test("the split gives each queue exactly one owner", () => {
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
    expect(splitRolesWith((c) => c.competitionActivityWorker)).toEqual([
      "activity-worker",
    ]);
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
    // duplicate guild-lifecycle writes; a second report-lake publisher means
    // two processes racing the CURRENT pointer on one shared volume; a second
    // metric sweeper multiplies one Prometheus scrape into N table sweeps.
    expect(splitRolesWith((c) => c.discordGateway)).toEqual(["gateway"]);
    expect(splitRolesWith((c) => c.voiceAssistant)).toEqual(["gateway"]);
    expect(splitRolesWith((c) => c.voiceStateAccess)).toEqual(["gateway"]);
    expect(splitRolesWith((c) => c.reportLakeFold)).toEqual(["application"]);
    expect(splitRolesWith((c) => c.databaseMetricSweeps)).toEqual([
      "application",
    ]);
    expect(splitRolesWith((c) => c.databaseSeeding)).toEqual(["application"]);
    expect(splitRolesWith((c) => c.httpSurface === "full")).toEqual([
      "application",
    ]);
    expect(splitRolesWith((c) => c.competitionActivityWorker)).toEqual([
      "activity-worker",
    ]);
    expect(splitRolesWith((c) => c.gatewayReadyReconciliation)).toEqual([
      "gateway",
    ]);
  });

  test("every role that runs an activity queue declares lake access", () => {
    // Every embedded activity queue reads the lake somewhere: realtime settles
    // SQL dares and evaluates hall progression, interactive runs Explore
    // queries, background runs reports and parlays, lake is the compactor. A
    // role that polls any of them without the lake mounted would answer those
    // queries with nothing and call it success.
    for (const role of SCOUT_RUNTIME_ROLES) {
      const capabilities = scoutRuntimeCapabilities(role);
      const runsWorkers =
        capabilities.temporalWorkers.length > 0 ||
        capabilities.deferredTemporalWorkers.length > 0;
      if (!runsWorkers) continue;
      expect(capabilities.reportLakeAccess).toBe(true);
    }
  });

  test("a role that folds the lake also reads it", () => {
    for (const role of SCOUT_RUNTIME_ROLES) {
      const capabilities = scoutRuntimeCapabilities(role);
      if (!capabilities.reportLakeFold) continue;
      expect(capabilities.reportLakeAccess).toBe(true);
    }
  });

  test("a role that receives Discord interactions declares lake access", () => {
    // Running a Temporal queue is NOT the test for needing the lake. `/scout
    // ask` and the Dare commands execute the Explore agent in whichever
    // process received the interaction — a synchronous DuckDB read on the
    // gateway role, with no queue anywhere in it. The gateway declared `false`
    // while doing exactly that, and since the boot gate runs only for roles
    // declaring `true`, the one pod that needed the check was the one that
    // skipped it.
    for (const role of SCOUT_RUNTIME_ROLES) {
      const capabilities = scoutRuntimeCapabilities(role);
      if (!capabilities.discordGateway) continue;
      expect(capabilities.reportLakeAccess).toBe(true);
    }
  });

  test("voice state is available exactly where the gateway is", () => {
    // Voice state arrives only as gateway events; there is no REST read for it.
    // A role that claimed it without a shard would silently move nobody.
    for (const role of SCOUT_RUNTIME_ROLES) {
      const capabilities = scoutRuntimeCapabilities(role);
      expect(capabilities.voiceStateAccess).toBe(capabilities.discordGateway);
    }
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
  test("an unset role is combined in development", () => {
    expect(parseScoutRuntimeRole(undefined, "dev")).toBe("combined");
    expect(parseScoutRuntimeRole("", "dev")).toBe("combined");
  });

  test.each(["beta", "prod"] as const)(
    "an unset role is refused in %s",
    (environment) => {
      expect(() => parseScoutRuntimeRole(undefined, environment)).toThrow(
        /SCOUT_RUNTIME_ROLE must be set/,
      );
      expect(() => parseScoutRuntimeRole("", environment)).toThrow(
        /SCOUT_RUNTIME_ROLE must be set/,
      );
    },
  );

  test.each(["beta", "prod"] as const)(
    "combined is refused in %s",
    (environment) => {
      expect(() => parseScoutRuntimeRole("combined", environment)).toThrow(
        /development-only/,
      );
    },
  );

  test.each(SCOUT_RUNTIME_ROLES)("parses %s in development", (role) => {
    expect(parseScoutRuntimeRole(role, "dev")).toBe(role);
  });

  test.each(SPLIT_ROLES)("parses %s in production", (role) => {
    expect(parseScoutRuntimeRole(role, "prod")).toBe(role);
  });

  test("an unrecognised role throws and names the alternatives", () => {
    expect(() => parseScoutRuntimeRole("worker", "dev")).toThrow(
      /Invalid SCOUT_RUNTIME_ROLE="worker", expected one of: combined, application, gateway, activity-worker/,
    );
  });

  test("the retired application-isolated name is not accepted", () => {
    expect(() => parseScoutRuntimeRole("application-isolated", "prod")).toThrow(
      /Invalid SCOUT_RUNTIME_ROLE/,
    );
  });

  test("a near-miss is not silently coerced", () => {
    expect(() => parseScoutRuntimeRole("Combined", "dev")).toThrow();
    expect(() => parseScoutRuntimeRole("activity_worker", "dev")).toThrow();
  });
});
