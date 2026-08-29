import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { EntityState } from "@shepherdjerred/home-assistant";
import { ApplicationFailure } from "@temporalio/common";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { OutcomeRecord } from "#activities/outcome.ts";
import {
  HA_ENTITY_NOT_FOUND_ERROR_TYPE,
  HA_OPTIONAL_MEDIA_PLAYER_ERROR_TYPE,
} from "#shared/ha-errors.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  goodMorningGetUp,
  goodMorningPreheat,
  goodMorningWakeUp,
  shouldHeatFloor,
} from "./good-morning.ts";

const TASK_QUEUE = TASK_QUEUES.HOME;
// Each integration case compiles and starts a native Temporal worker. The
// default 5s Bun timeout is too short when the full repository test graph is
// sharing the CI host, even though workflow time itself is skipped.
const WORKFLOW_TEST_TIMEOUT_MS = 30_000;
// Sentinel for "Home Assistant does not have this entity at all", which the
// activity surfaces as a typed failure rather than any state string.
const MISSING_ENTITY = "__missing__";
const DEFAULT_ZONE_ATTRIBUTES: Record<string, unknown> = {
  latitude: 47.6,
  longitude: -122.3,
};

let testEnv: TestWorkflowEnvironment;

beforeAll(async () => {
  testEnv = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnv.teardown();
});

type ServiceCall = {
  domain: string;
  service: string;
  data: Record<string, unknown>;
};

type Scenario = {
  indoorC: number;
  indoorState: string;
  outdoorC: number;
  zoneAttributes: Record<string, unknown>;
  temperatureReadAttempts: number;
  serviceCalls: ServiceCall[];
  notifications: string[];
  outcomes: OutcomeRecord[];
  mediaPlayerFailures: Set<string>;
};

function makeScenario(
  temps: { indoorC: number; outdoorC: number },
  zoneAttributes: Record<string, unknown> = DEFAULT_ZONE_ATTRIBUTES,
): Scenario {
  return {
    indoorC: temps.indoorC,
    indoorState: String(temps.indoorC),
    outdoorC: temps.outdoorC,
    zoneAttributes,
    temperatureReadAttempts: 0,
    serviceCalls: [],
    notifications: [],
    outcomes: [],
    mediaPlayerFailures: new Set(),
  };
}

function entityState(
  entityId: string,
  state: string,
  attributes: Record<string, unknown> = {},
): EntityState {
  return { entity_id: entityId, state, attributes };
}

function makeActivities(scenario: Scenario) {
  const callMediaPlayerService = (
    service: string,
    data: Record<string, unknown>,
  ): Promise<void> => {
    scenario.serviceCalls.push({
      domain: "media_player",
      service,
      data,
    });
    const entityId = data["entity_id"];
    if (
      typeof entityId === "string" &&
      scenario.mediaPlayerFailures.has(`${service}:${entityId}`)
    ) {
      return Promise.reject(
        ApplicationFailure.retryable(
          `Home Assistant media_player.${service} unavailable for ${entityId}`,
          HA_OPTIONAL_MEDIA_PLAYER_ERROR_TYPE,
        ),
      );
    }
    return Promise.resolve();
  };

  return {
    getEntityState: (entityId: string): Promise<EntityState> => {
      switch (entityId) {
        case "person.jerred":
          return Promise.resolve(entityState(entityId, "home"));
        case "person.shuxin":
          return Promise.resolve(entityState(entityId, "not_home"));
        case "sensor.master_bathroom_temperature":
          if (scenario.indoorState === MISSING_ENTITY) {
            scenario.temperatureReadAttempts += 1;
            // Retryable, exactly as the real activity raises it, so the
            // degraded path is exercised only after the retry budget runs out.
            return Promise.reject(
              ApplicationFailure.retryable(
                `Home Assistant has no entity ${entityId}`,
                HA_ENTITY_NOT_FOUND_ERROR_TYPE,
              ),
            );
          }
          return Promise.resolve(
            entityState(entityId, scenario.indoorState, {
              unit_of_measurement: "°C",
            }),
          );
        case "zone.home":
          return Promise.resolve(
            entityState(entityId, "zoning", scenario.zoneAttributes),
          );
        default:
          throw new Error(`Unexpected entity read: ${entityId}`);
      }
    },
    callService: (
      domain: string,
      service: string,
      data: Record<string, unknown>,
    ): Promise<void> => {
      if (domain === "media_player") {
        return callMediaPlayerService(service, data);
      }
      scenario.serviceCalls.push({ domain, service, data });
      return Promise.resolve();
    },
    callOptionalMediaPlayerService: callMediaPlayerService,
    sendNotification: (title: string): Promise<void> => {
      scenario.notifications.push(title);
      return Promise.resolve();
    },
    recordWorkflowOutcome: (record: OutcomeRecord): Promise<void> => {
      scenario.outcomes.push(record);
      return Promise.resolve();
    },
    getOutdoorTemperatureC: (): Promise<number> => {
      return Promise.resolve(scenario.outdoorC);
    },
  };
}

const TURN_OFF_MASTER_BATHROOM: ServiceCall = {
  domain: "climate",
  service: "turn_off",
  data: { entity_id: "climate.master_bathroom" },
};

function climateCalls(scenario: Scenario): ServiceCall[] {
  return scenario.serviceCalls.filter((call) => call.domain === "climate");
}

async function runWorker<T>(
  scenario: Scenario,
  workflow: () => Promise<T>,
  workflowId: string,
): Promise<T> {
  const worker = await Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: new URL("../index.ts", import.meta.url).pathname,
    activities: makeActivities(scenario),
  });
  return worker.runUntil(() =>
    testEnv.client.workflow.execute(workflow, {
      taskQueue: TASK_QUEUE,
      workflowId,
    }),
  );
}

async function expectNonRetryableApplicationFailure(
  execution: Promise<unknown>,
  expectedType: string,
  expectedMessage: string,
): Promise<void> {
  let failure: unknown;
  try {
    await execution;
  } catch (error) {
    failure = error;
  }
  if (!(failure instanceof Error)) {
    throw new Error("Expected workflow execution to fail");
  }
  const cause = failure.cause;
  if (!(cause instanceof ApplicationFailure)) {
    throw new TypeError(
      "Expected workflow failure to include an ApplicationFailure cause",
    );
  }
  expect(cause.type).toBe(expectedType);
  expect(cause.nonRetryable).toBe(true);
  expect(cause.message).toBe(expectedMessage);
}

describe("shouldHeatFloor", () => {
  test("heats at or below either threshold, skips above both", () => {
    expect(shouldHeatFloor({ indoorC: 20, outdoorC: 26 })).toBe(true);
    expect(shouldHeatFloor({ indoorC: 18, outdoorC: 26 })).toBe(true);
    expect(shouldHeatFloor({ indoorC: 26, outdoorC: 15 })).toBe(true);
    expect(shouldHeatFloor({ indoorC: 26, outdoorC: 10 })).toBe(true);
    expect(shouldHeatFloor({ indoorC: 20.1, outdoorC: 15.1 })).toBe(false);
    expect(shouldHeatFloor({ indoorC: 26, outdoorC: 28 })).toBe(false);
  });
});

describe("floor heat weather inputs", () => {
  test(
    "fails non-retryably when zone coordinates are malformed",
    async () => {
      const scenario = makeScenario(
        { indoorC: 18, outdoorC: 5 },
        { latitude: "47.6", longitude: -122.3 },
      );
      await expectNonRetryableApplicationFailure(
        runWorker(
          scenario,
          goodMorningPreheat,
          `preheat-invalid-zone-${crypto.randomUUID()}`,
        ),
        "HomeZoneAttributesError",
        "Home Assistant zone.home attributes must include numeric latitude and longitude",
      );
      expect(climateCalls(scenario)).toEqual([]);
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );
});

describe("goodMorningPreheat", () => {
  test(
    "skips without touching the thermostat on a warm morning",
    async () => {
      const scenario = makeScenario({ indoorC: 26, outdoorC: 28 });
      await runWorker(
        scenario,
        goodMorningPreheat,
        `preheat-warm-${crypto.randomUUID()}`,
      );
      expect(climateCalls(scenario)).toEqual([]);
      expect(scenario.outcomes).toEqual([
        {
          workflow: "goodMorningPreheat",
          outcome: "skipped",
          reason: "not-cold",
        },
      ]);
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );

  test(
    "heats to 30°C when the bathroom air is cold",
    async () => {
      const scenario = makeScenario({ indoorC: 18, outdoorC: 28 });
      await runWorker(
        scenario,
        goodMorningPreheat,
        `preheat-cold-indoor-${crypto.randomUUID()}`,
      );
      const calls = climateCalls(scenario);
      expect(calls[0]).toEqual({
        domain: "climate",
        service: "set_temperature",
        data: {
          entity_id: "climate.master_bathroom",
          temperature: 30,
          hvac_mode: "heat",
        },
      });
      expect(calls.at(-1)?.service).toBe("turn_off");
      expect(scenario.outcomes).toEqual([
        {
          workflow: "goodMorningPreheat",
          outcome: "executed",
          reason: "preheat-complete",
        },
      ]);
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );

  test(
    "heats when it is cold outside even if the bathroom is warm",
    async () => {
      const scenario = makeScenario({ indoorC: 22, outdoorC: 10 });
      await runWorker(
        scenario,
        goodMorningPreheat,
        `preheat-cold-outdoor-${crypto.randomUUID()}`,
      );
      expect(climateCalls(scenario)[0]?.service).toBe("set_temperature");
      expect(scenario.outcomes).toEqual([
        {
          workflow: "goodMorningPreheat",
          outcome: "executed",
          reason: "preheat-complete",
        },
      ]);
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );
});

describe("goodMorningWakeUp", () => {
  test(
    "keeps the turn-off backstop while skipping heat when temperature is unavailable",
    async () => {
      const scenario = makeScenario({ indoorC: 18, outdoorC: 5 });
      scenario.indoorState = "unavailable";

      await runWorker(
        scenario,
        goodMorningWakeUp,
        "wake-temperature-unavailable-" + crypto.randomUUID(),
      );

      expect(climateCalls(scenario)).toEqual([TURN_OFF_MASTER_BATHROOM]);
      expect(scenario.notifications).toEqual(["Good Morning"]);
      expect(
        scenario.serviceCalls.some(
          (call) =>
            call.domain === "media_player" && call.service === "play_media",
        ),
      ).toBe(true);
      expect(scenario.outcomes).toEqual([
        {
          workflow: "goodMorningWakeUp",
          outcome: "executed",
          reason: "wake-routine-complete-temperature-unavailable",
        },
      ]);
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );

  test(
    "fails non-retryably for unrelated climate decision failures",
    async () => {
      const scenario = makeScenario(
        { indoorC: 18, outdoorC: 5 },
        { latitude: "47.6", longitude: -122.3 },
      );
      await expectNonRetryableApplicationFailure(
        runWorker(
          scenario,
          goodMorningWakeUp,
          `wake-invalid-zone-${crypto.randomUUID()}`,
        ),
        "HomeZoneAttributesError",
        "Home Assistant zone.home attributes must include numeric latitude and longitude",
      );
      expect(scenario.notifications).toEqual([]);
      expect(climateCalls(scenario)).toEqual([]);
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );

  test(
    "degrades when the temperature entity is missing from Home Assistant",
    async () => {
      const scenario = makeScenario({ indoorC: 18, outdoorC: 5 });
      scenario.indoorState = MISSING_ENTITY;

      await runWorker(
        scenario,
        goodMorningWakeUp,
        `wake-temperature-missing-${crypto.randomUUID()}`,
      );

      // The shared three-attempt policy still applies, so a transiently
      // missing entity during an HA restart recovers instead of degrading.
      expect(scenario.temperatureReadAttempts).toBe(3);
      expect(climateCalls(scenario)).toEqual([TURN_OFF_MASTER_BATHROOM]);
      expect(scenario.notifications).toEqual(["Good Morning"]);
      expect(scenario.outcomes).toEqual([
        {
          workflow: "goodMorningWakeUp",
          outcome: "executed",
          reason: "wake-routine-complete-temperature-unavailable",
        },
      ]);
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );

  test(
    "fails non-retryably on a corrupt temperature state instead of degrading",
    async () => {
      const scenario = makeScenario({ indoorC: 18, outdoorC: 5 });
      scenario.indoorState = "error";

      await expectNonRetryableApplicationFailure(
        runWorker(
          scenario,
          goodMorningWakeUp,
          `wake-corrupt-temperature-${crypto.randomUUID()}`,
        ),
        "TemperatureSensorStateError",
        "Temperature sensor sensor.master_bathroom_temperature has a non-numeric state: error",
      );
      expect(scenario.notifications).toEqual([]);
      expect(climateCalls(scenario)).toEqual([]);
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );

  test(
    "runs the wake routine without heat on a warm morning",
    async () => {
      const scenario = makeScenario({ indoorC: 26, outdoorC: 28 });
      await runWorker(
        scenario,
        goodMorningWakeUp,
        `wake-warm-${crypto.randomUUID()}`,
      );
      expect(climateCalls(scenario)).toEqual([TURN_OFF_MASTER_BATHROOM]);
      expect(scenario.notifications).toEqual(["Good Morning"]);
      expect(
        scenario.serviceCalls.some(
          (call) => call.domain === "scene" && call.service === "turn_on",
        ),
      ).toBe(true);
      expect(scenario.outcomes).toEqual([
        {
          workflow: "goodMorningWakeUp",
          outcome: "executed",
          reason: "wake-routine-complete-no-heat",
        },
      ]);
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );

  test(
    "heats through the wake window on a cold morning",
    async () => {
      const scenario = makeScenario({ indoorC: 18, outdoorC: 5 });
      await runWorker(
        scenario,
        goodMorningWakeUp,
        `wake-cold-${crypto.randomUUID()}`,
      );
      const calls = climateCalls(scenario);
      expect(calls[0]?.service).toBe("set_temperature");
      expect(calls.at(-1)?.service).toBe("turn_off");
      expect(scenario.outcomes).toEqual([
        {
          workflow: "goodMorningWakeUp",
          outcome: "executed",
          reason: "wake-routine-complete",
        },
      ]);
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );
});

describe("goodMorningGetUp", () => {
  test(
    "joins the available bathroom speaker and completes normally",
    async () => {
      const scenario = makeScenario({ indoorC: 26, outdoorC: 28 });

      await runWorker(
        scenario,
        goodMorningGetUp,
        `getup-complete-${crypto.randomUUID()}`,
      );

      expect(
        scenario.serviceCalls.some(
          (call) => call.domain === "media_player" && call.service === "join",
        ),
      ).toBe(true);
      expect(
        scenario.serviceCalls.filter(
          (call) =>
            call.domain === "media_player" && call.service === "volume_up",
        ),
      ).toHaveLength(4);
      expect(scenario.outcomes).toEqual([
        {
          workflow: "goodMorningGetUp",
          outcome: "executed",
          reason: "getup-routine-complete",
        },
      ]);
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );

  test(
    "continues with bedroom playback when the optional join fails",
    async () => {
      const scenario = makeScenario({ indoorC: 26, outdoorC: 28 });
      scenario.mediaPlayerFailures.add("join:media_player.bedroom");

      await runWorker(
        scenario,
        goodMorningGetUp,
        `getup-join-degraded-${crypto.randomUUID()}`,
      );

      expect(
        scenario.serviceCalls.filter(
          (call) =>
            call.domain === "media_player" && call.service === "volume_up",
        ),
      ).toHaveLength(2);
      expect(scenario.outcomes).toEqual([
        {
          workflow: "goodMorningGetUp",
          outcome: "executed",
          reason: "getup-routine-complete-optional-media-degraded",
        },
      ]);
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );

  test(
    "skips an optional player whose volume setup fails",
    async () => {
      const scenario = makeScenario({ indoorC: 26, outdoorC: 28 });
      scenario.mediaPlayerFailures.add(
        "volume_set:media_player.master_bathroom",
      );

      await runWorker(
        scenario,
        goodMorningGetUp,
        `getup-volume-degraded-${crypto.randomUUID()}`,
      );

      expect(
        scenario.serviceCalls.some(
          (call) => call.domain === "media_player" && call.service === "join",
        ),
      ).toBe(false);
      expect(scenario.outcomes).toEqual([
        {
          workflow: "goodMorningGetUp",
          outcome: "executed",
          reason: "getup-routine-complete-optional-media-degraded",
        },
      ]);
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );

  test(
    "still fails when required bedroom playback fails",
    async () => {
      const scenario = makeScenario({ indoorC: 26, outdoorC: 28 });
      scenario.mediaPlayerFailures.add("volume_up:media_player.bedroom");

      await expect(
        runWorker(
          scenario,
          goodMorningGetUp,
          `getup-bedroom-failure-${crypto.randomUUID()}`,
        ),
      ).rejects.toThrow();
      expect(scenario.outcomes).toEqual([]);
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );
});
