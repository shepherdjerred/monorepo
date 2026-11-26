import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { EntityState } from "@shepherdjerred/home-assistant";
import { ApplicationFailure } from "@temporalio/common";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { OutcomeRecord } from "#activities/outcome.ts";
import { OUTDOOR_WEATHER_UNAVAILABLE_ERROR_TYPE } from "#shared/infra/ha-errors.ts";
import { isConfirmedAway } from "#shared/infra/presence.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { applyClimateSchedule } from "./apply-climate-schedule.ts";
import {
  climatePhase,
  desiredClimateCommand,
  losAngelesHour,
  type ClimateRoom,
} from "./climate-policy.ts";
import { reconcileClimate } from "./reconcile-climate.ts";

const TASK_QUEUE = TASK_QUEUES.HOME;
const WORKFLOW_TEST_TIMEOUT_MS = 30_000;

type ServiceCall = {
  domain: string;
  service: string;
  data: Record<string, unknown>;
};

type RoomFixture = {
  mode: string;
  targetC?: number;
  currentC?: number;
};

type Scenario = {
  jerred: string;
  shuxin: string;
  outdoorC: number;
  weatherFailure: ApplicationFailure | undefined;
  bedroom: RoomFixture;
  livingRoom: RoomFixture;
  zoneAttributes: Record<string, unknown>;
  serviceCalls: ServiceCall[];
  outcomes: OutcomeRecord[];
};

let testEnv: TestWorkflowEnvironment;

beforeAll(async () => {
  testEnv = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnv.teardown();
});

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    jerred: "home",
    shuxin: "home",
    outdoorC: 5,
    weatherFailure: undefined,
    bedroom: { mode: "off", currentC: 19 },
    livingRoom: { mode: "off", currentC: 18.5 },
    zoneAttributes: { latitude: 47.6, longitude: -122.3 },
    serviceCalls: [],
    outcomes: [],
    ...overrides,
  };
}

function entityState(
  entityId: string,
  state: string,
  attributes: Record<string, unknown> = {},
): EntityState {
  return { entity_id: entityId, state, attributes };
}

function climateAttributes(room: RoomFixture): Record<string, unknown> {
  return {
    ...(room.targetC === undefined ? {} : { temperature: room.targetC }),
    ...(room.currentC === undefined
      ? {}
      : { current_temperature: room.currentC }),
  };
}

function activities(world: Scenario) {
  return {
    getEntityState: (entityId: string): Promise<EntityState> => {
      switch (entityId) {
        case "person.jerred":
          return Promise.resolve(entityState(entityId, world.jerred));
        case "person.shuxin":
          return Promise.resolve(entityState(entityId, world.shuxin));
        case "zone.home":
          return Promise.resolve(
            entityState(entityId, "zoning", world.zoneAttributes),
          );
        case "climate.bedroom":
          return Promise.resolve(
            entityState(
              entityId,
              world.bedroom.mode,
              climateAttributes(world.bedroom),
            ),
          );
        case "climate.living_room":
          return Promise.resolve(
            entityState(
              entityId,
              world.livingRoom.mode,
              climateAttributes(world.livingRoom),
            ),
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
      world.serviceCalls.push({ domain, service, data });
      return Promise.resolve();
    },
    recordWorkflowOutcome: (record: OutcomeRecord): Promise<void> => {
      world.outcomes.push(record);
      return Promise.resolve();
    },
    getOutdoorTemperatureC: (): Promise<number> =>
      world.weatherFailure === undefined
        ? Promise.resolve(world.outdoorC)
        : Promise.reject(world.weatherFailure),
  };
}

async function run<T>(
  world: Scenario,
  workflow: () => Promise<T>,
  workflowId: string,
): Promise<T> {
  const worker = await Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: new URL("../index.ts", import.meta.url).pathname,
    activities: activities(world),
  });
  return worker.runUntil(() =>
    testEnv.client.workflow.execute(workflow, {
      taskQueue: TASK_QUEUE,
      workflowId,
    }),
  );
}

function roomState(room: RoomFixture) {
  return {
    mode: room.mode,
    targetC: room.targetC,
    currentC: room.currentC,
  };
}

async function expectedCalls(world: Scenario): Promise<ServiceCall[]> {
  const phase = climatePhase(
    losAngelesHour(new Date(await testEnv.currentTimeMs())),
  );
  const occupied = world.jerred === "home" || world.shuxin === "home";
  const everyoneConfirmedAway = [world.jerred, world.shuxin].every((state) =>
    isConfirmedAway(state),
  );
  const calls: ServiceCall[] = [];
  for (const [room, entityId, fixture] of [
    ["bedroom", "climate.bedroom", world.bedroom],
    ["living_room", "climate.living_room", world.livingRoom],
  ] as const) {
    const command = desiredClimateCommand({
      room: room satisfies ClimateRoom,
      phase,
      occupied,
      everyoneConfirmedAway,
      outdoorC: world.weatherFailure === undefined ? world.outdoorC : undefined,
      roomState: roomState(fixture),
    });
    if (command.kind === "heat") {
      calls.push({
        domain: "climate",
        service: "set_temperature",
        data: {
          entity_id: entityId,
          temperature: command.temperatureC,
          hvac_mode: "heat",
        },
      });
    } else if (command.kind === "turn_off") {
      calls.push({
        domain: "climate",
        service: "turn_off",
        data: { entity_id: entityId },
      });
    }
  }
  return calls;
}

async function advanceToHour(hour: number): Promise<void> {
  const now = await testEnv.currentTimeMs();
  const current = losAngelesHour(new Date(now));
  const delta = (hour - current + 24) % 24;
  if (delta !== 0) await testEnv.sleep(delta * 60 * 60 * 1000);
}

describe("applyClimateSchedule", () => {
  test(
    "applies the decision for the current Los Angeles phase",
    async () => {
      const world = scenario();
      const expected = await expectedCalls(world);
      await run(
        world,
        applyClimateSchedule,
        `climate-schedule-${crypto.randomUUID()}`,
      );
      expect(world.serviceCalls).toEqual(expected);
      expect(world.outcomes[0]?.outcome).toBe(
        expected.length === 0 ? "skipped" : "executed",
      );
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );

  test(
    "heats to the day setpoint at 15:00 and sets back at 02:00",
    async () => {
      await advanceToHour(15);
      const day = scenario();
      await run(
        day,
        applyClimateSchedule,
        `climate-day-${crypto.randomUUID()}`,
      );
      expect(day.serviceCalls).toEqual([
        {
          domain: "climate",
          service: "set_temperature",
          data: {
            entity_id: "climate.bedroom",
            temperature: 21,
            hvac_mode: "heat",
          },
        },
        {
          domain: "climate",
          service: "set_temperature",
          data: {
            entity_id: "climate.living_room",
            temperature: 21,
            hvac_mode: "heat",
          },
        },
      ]);

      await advanceToHour(2);
      const night = scenario({
        bedroom: { mode: "heat", targetC: 21, currentC: 21 },
        livingRoom: { mode: "heat", targetC: 21, currentC: 21 },
      });
      await run(
        night,
        applyClimateSchedule,
        `climate-night-${crypto.randomUUID()}`,
      );
      expect(night.serviceCalls).toEqual([
        {
          domain: "climate",
          service: "set_temperature",
          data: {
            entity_id: "climate.bedroom",
            temperature: 18,
            hvac_mode: "heat",
          },
        },
        {
          domain: "climate",
          service: "turn_off",
          data: { entity_id: "climate.living_room" },
        },
      ]);
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );

  test(
    "leaves a cool bedroom alone and still heats when the room is cold without weather",
    async () => {
      await advanceToHour(15);
      const cooling = scenario({
        bedroom: { mode: "cool", targetC: 24, currentC: 22 },
        weatherFailure: ApplicationFailure.retryable(
          "Open-Meteo request failed: timed out",
          OUTDOOR_WEATHER_UNAVAILABLE_ERROR_TYPE,
        ),
      });
      await run(
        cooling,
        applyClimateSchedule,
        `climate-cool-${crypto.randomUUID()}`,
      );
      expect(cooling.serviceCalls).toEqual([
        {
          domain: "climate",
          service: "set_temperature",
          data: {
            entity_id: "climate.living_room",
            temperature: 21,
            hvac_mode: "heat",
          },
        },
      ]);
      expect(cooling.outcomes[0]?.reason).toBe("applied-weather-unavailable");
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );
});

describe("reconcileClimate", () => {
  test(
    "turns heat off after the presence window when everyone is away",
    async () => {
      await advanceToHour(15);
      const world = scenario({
        jerred: "not_home",
        shuxin: "Work",
        bedroom: { mode: "heat", targetC: 21, currentC: 21 },
        livingRoom: { mode: "heat", targetC: 21, currentC: 21 },
      });
      await run(
        world,
        reconcileClimate,
        `climate-reconcile-${crypto.randomUUID()}`,
      );
      expect(world.serviceCalls).toEqual([
        {
          domain: "climate",
          service: "turn_off",
          data: { entity_id: "climate.bedroom" },
        },
        {
          domain: "climate",
          service: "turn_off",
          data: { entity_id: "climate.living_room" },
        },
      ]);
    },
    WORKFLOW_TEST_TIMEOUT_MS,
  );
});
