import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { EntityState } from "@shepherdjerred/home-assistant";
import { ApplicationFailure } from "@temporalio/common";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { OutcomeRecord } from "#activities/outcome.ts";
import {
  goodMorningPreheat,
  goodMorningWakeUp,
  shouldHeatFloor,
} from "./good-morning.ts";

const TASK_QUEUE = "good-morning-test";
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
  outdoorC: number;
  zoneAttributes: Record<string, unknown>;
  serviceCalls: ServiceCall[];
  notifications: string[];
  outcomes: OutcomeRecord[];
};

function makeScenario(
  temps: { indoorC: number; outdoorC: number },
  zoneAttributes: Record<string, unknown> = DEFAULT_ZONE_ATTRIBUTES,
): Scenario {
  return {
    indoorC: temps.indoorC,
    outdoorC: temps.outdoorC,
    zoneAttributes,
    serviceCalls: [],
    notifications: [],
    outcomes: [],
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
  return {
    getEntityState: (entityId: string): Promise<EntityState> => {
      switch (entityId) {
        case "person.jerred":
          return Promise.resolve(entityState(entityId, "home"));
        case "person.shuxin":
          return Promise.resolve(entityState(entityId, "not_home"));
        case "sensor.master_bathroom_temperature":
          return Promise.resolve(
            entityState(entityId, String(scenario.indoorC), {
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
      scenario.serviceCalls.push({ domain, service, data });
      return Promise.resolve();
    },
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
  test("fails non-retryably when zone coordinates are malformed", async () => {
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
  });
});

describe("goodMorningPreheat", () => {
  test("skips without touching the thermostat on a warm morning", async () => {
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
  });

  test("heats to 30°C when the bathroom air is cold", async () => {
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
  });

  test("heats when it is cold outside even if the bathroom is warm", async () => {
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
  });
});

describe("goodMorningWakeUp", () => {
  test("runs the wake routine without heat on a warm morning", async () => {
    const scenario = makeScenario({ indoorC: 26, outdoorC: 28 });
    await runWorker(
      scenario,
      goodMorningWakeUp,
      `wake-warm-${crypto.randomUUID()}`,
    );
    expect(climateCalls(scenario)).toEqual([
      {
        domain: "climate",
        service: "turn_off",
        data: {
          entity_id: "climate.master_bathroom",
        },
      },
    ]);
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
  });

  test("heats through the wake window on a cold morning", async () => {
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
  });
});
