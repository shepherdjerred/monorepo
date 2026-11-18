import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { EntityState } from "@shepherdjerred/home-assistant";
import { WorkflowIdReusePolicy } from "@temporalio/client";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { OutcomeRecord } from "#activities/outcome.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import {
  reconcileRoborock,
  roborockUnavailable,
} from "./reconcile-roborock.ts";

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await env.teardown();
});

async function createRoborockTestHost(initialStates: Record<string, string>) {
  const states = new Map<string, string>(Object.entries(initialStates));
  const reloadedTargets: string[] = [];
  const outcomes: OutcomeRecord[] = [];

  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUES.HOME,
    workflowsPath: new URL("../index.ts", import.meta.url).pathname,
    activities: {
      getEntityState: async (id: string): Promise<EntityState> => ({
        entity_id: id,
        state: states.get(id) ?? "docked",
        attributes: {},
      }),
      callService: async (
        domain: string,
        service: string,
        payload: Record<string, unknown>,
      ): Promise<void> => {
        expect(domain).toBe("homeassistant");
        expect(service).toBe("reload_config_entry");
        reloadedTargets.push(String(payload["entity_id"]));
      },
      recordWorkflowOutcome: async (entry: OutcomeRecord): Promise<void> => {
        outcomes.push(entry);
      },
    },
  });

  return { worker, reloadedTargets, outcomes };
}

describe("reconcileRoborock", () => {
  test("skips config entry reload when vacuums recover during the 3-minute settle window", async () => {
    const host = await createRoborockTestHost({
      "vacuum.1st_floor": "docked",
      "vacuum.2nd_floor": "cleaning",
      "vacuum.3rd_floor": "docked",
    });

    await host.worker.runUntil(async () => {
      const handle = await env.client.workflow.signalWithStart(
        reconcileRoborock,
        {
          taskQueue: TASK_QUEUES.HOME,
          workflowId: `reconcile-roborock-skip-${crypto.randomUUID()}`,
          workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
          signal: roborockUnavailable,
          signalArgs: [],
        },
      );
      await handle.result();
    });

    expect(host.reloadedTargets).toEqual([]);
    expect(host.outcomes).toEqual([
      {
        workflow: "reconcileRoborock",
        outcome: "skipped",
        reason: "all-available",
      },
    ]);
  }, 60_000);

  test("reloads config entry once after 3m and absorbs repeat signals during the 30m cooldown", async () => {
    const host = await createRoborockTestHost({
      "vacuum.1st_floor": "unavailable",
      "vacuum.2nd_floor": "unavailable",
      "vacuum.3rd_floor": "unavailable",
    });
    const singletonWorkflowId = `reconcile-roborock-heal-${crypto.randomUUID()}`;

    await host.worker.runUntil(async () => {
      const startedAt = await env.currentTimeMs();
      const handle = await env.client.workflow.signalWithStart(
        reconcileRoborock,
        {
          taskQueue: TASK_QUEUES.HOME,
          workflowId: singletonWorkflowId,
          workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
          signal: roborockUnavailable,
          signalArgs: [],
        },
      );

      // Advance past the 3m settle window into the 30m post-reload cooldown.
      await env.sleep("4 minutes");
      expect(host.reloadedTargets).toEqual(["vacuum.1st_floor"]);

      // A second unavailable signal arriving mid-cooldown attaches to the open
      // singleton run and must not trigger a duplicate config entry reload.
      await env.client.workflow.signalWithStart(reconcileRoborock, {
        taskQueue: TASK_QUEUES.HOME,
        workflowId: singletonWorkflowId,
        workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
        signal: roborockUnavailable,
        signalArgs: [],
      });

      await handle.result();
      const finishedAt = await env.currentTimeMs();
      expect(finishedAt - startedAt).toBeGreaterThanOrEqual(33 * 60 * 1000);
    });

    expect(host.reloadedTargets).toEqual(["vacuum.1st_floor"]);
    expect(host.outcomes).toEqual([
      {
        workflow: "reconcileRoborock",
        outcome: "executed",
        reason: "reloaded-config-entry",
      },
    ]);
  }, 60_000);
});
