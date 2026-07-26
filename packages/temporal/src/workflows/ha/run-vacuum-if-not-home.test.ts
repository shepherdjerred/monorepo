import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { EntityState } from "@shepherdjerred/home-assistant";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { OutcomeRecord } from "#activities/outcome.ts";
import { runVacuumIfNotHome } from "./run-vacuum-if-not-home.ts";
import { VACUUMS } from "./util.ts";

const TASK_QUEUE = "run-vacuum-if-not-home-test";

let testEnv: TestWorkflowEnvironment;

beforeAll(async () => {
  testEnv = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnv.teardown();
});

type Scenario = {
  makeStartedUnitsActive: boolean;
  outcomes: OutcomeRecord[];
  started: string[];
  states: Map<string, string>;
};

function makeScenario(
  vacuumStates: readonly string[],
  makeStartedUnitsActive: boolean,
): Scenario {
  if (vacuumStates.length !== VACUUMS.length) {
    throw new Error(
      `Expected ${String(VACUUMS.length)} vacuum states, received ${String(vacuumStates.length)}`,
    );
  }

  const states = new Map<string, string>([
    ["person.jerred", "not_home"],
    ["person.shuxin", "not_home"],
  ]);
  VACUUMS.forEach((vacuum, index) => {
    const state = vacuumStates[index];
    if (state === undefined) {
      throw new Error(`Missing test state for ${vacuum}`);
    }
    states.set(vacuum, state);
  });

  return {
    makeStartedUnitsActive,
    outcomes: [],
    started: [],
    states,
  };
}

function entityState(entityId: string, state: string): EntityState {
  return {
    entity_id: entityId,
    state,
    attributes: {},
  };
}

async function expectWorkflowFailure(
  execution: Promise<unknown>,
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
  if (!(cause instanceof Error)) {
    throw new Error("Expected workflow failure to include an Error cause");
  }
  expect(cause.message).toBe(expectedMessage);
}

describe("runVacuumIfNotHome", () => {
  test("classifies fleet state and records only verified starts", async () => {
    let scenario = makeScenario(["cleaning", "returning", "cleaning"], false);

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: new URL("../index.ts", import.meta.url).pathname,
      activities: {
        getEntityState: async (entityId: string) => {
          const state = scenario.states.get(entityId);
          if (state === undefined) {
            throw new Error(`Missing test state for ${entityId}`);
          }
          return entityState(entityId, state);
        },
        callService: async (
          domain: string,
          service: string,
          data: Record<string, unknown>,
        ) => {
          if (domain !== "vacuum" || service !== "start") {
            throw new Error(`Unexpected service call: ${domain}.${service}`);
          }
          const entityId = data["entity_id"];
          if (typeof entityId !== "string") {
            throw new TypeError("Expected vacuum.start entity_id");
          }
          scenario.started.push(entityId);
          if (scenario.makeStartedUnitsActive) {
            scenario.states.set(entityId, "cleaning");
          }
        },
        sendNotification: () => Promise.resolve(),
        recordWorkflowOutcome: async (record: OutcomeRecord) => {
          scenario.outcomes.push(record);
        },
      },
    });

    await worker.runUntil(async () => {
      await testEnv.client.workflow.execute(runVacuumIfNotHome, {
        taskQueue: TASK_QUEUE,
        workflowId: `vacuum-all-active-${crypto.randomUUID()}`,
      });
      expect(scenario.started).toEqual([]);
      expect(scenario.outcomes).toEqual([
        {
          workflow: "runVacuumIfNotHome",
          outcome: "skipped",
          reason: "all-units-active",
        },
      ]);

      scenario = makeScenario(["cleaning", "returning", "unavailable"], false);
      await expectWorkflowFailure(
        testEnv.client.workflow.execute(runVacuumIfNotHome, {
          taskQueue: TASK_QUEUE,
          workflowId: `vacuum-anomalous-${crypto.randomUUID()}`,
        }),
        "Vacuum fleet has anomalous states: vacuum.3rd_floor=unavailable",
      );
      expect(scenario.started).toEqual([]);
      expect(scenario.outcomes).toEqual([]);

      scenario = makeScenario(["docked", "cleaning", "returning"], false);
      await expectWorkflowFailure(
        testEnv.client.workflow.execute(runVacuumIfNotHome, {
          taskQueue: TASK_QUEUE,
          workflowId: `vacuum-verification-failed-${crypto.randomUUID()}`,
        }),
        "Vacuum start verification failed: vacuum.1st_floor did not become active",
      );
      expect(scenario.started).toEqual(["vacuum.1st_floor"]);
      expect(scenario.outcomes).toEqual([]);

      scenario = makeScenario(["docked", "cleaning", "returning"], true);
      await testEnv.client.workflow.execute(runVacuumIfNotHome, {
        taskQueue: TASK_QUEUE,
        workflowId: `vacuum-started-${crypto.randomUUID()}`,
      });
      expect(scenario.started).toEqual(["vacuum.1st_floor"]);
      expect(scenario.outcomes).toEqual([
        {
          workflow: "runVacuumIfNotHome",
          outcome: "executed",
          reason: "started",
        },
      ]);
    });
  }, 60_000);
});
