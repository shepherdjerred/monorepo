import { describe, expect, test, vi } from "vitest";
import type { Client } from "@temporalio/client";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import type { PetCareSensorUpdate } from "#shared/infra/pet-care.ts";
import {
  handleIosAction,
  handleStateChanged,
  syncPetCareStates,
} from "./triggers.ts";

type WorkflowStart = (
  workflowType: string,
  options: { taskQueue: string; workflowId: string },
) => Promise<unknown>;

type WorkflowSignalWithStart = (
  workflowType: string,
  options: {
    workflowId: string;
    signal: string;
    signalArgs: [PetCareSensorUpdate];
    taskQueue?: string;
    workflowIdReusePolicy?: unknown;
  },
) => Promise<unknown>;

function fakeClient(start: WorkflowStart): Client {
  const client = Object.create(null);
  client.workflow = { start };
  return client;
}

function fakeSignalClient(signalWithStart: WorkflowSignalWithStart): Client {
  const client = Object.create(null);
  client.workflow = { signalWithStart };
  return client;
}

describe("Home Assistant event routing", () => {
  test("starts iOS good-night actions on the home queue", async () => {
    const start = vi.fn<WorkflowStart>(() => Promise.resolve());
    await handleIosAction(fakeClient(start))({
      data: { actionID: "A91A15AA-479E-416C-8F51-BD983A999266" },
    });

    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]?.[0]).toBe("goodNight");
    expect(start.mock.calls[0]?.[1]).toMatchObject({
      taskQueue: TASK_QUEUES.WORKFLOWS,
    });
  });

  test("routes pet-care sensor changes to the durable singleton workflow", async () => {
    const signalWithStart = vi.fn<WorkflowSignalWithStart>(() =>
      Promise.resolve(),
    );
    const client = fakeSignalClient(signalWithStart);
    const rest = Object.create(null);

    await handleStateChanged(
      client,
      rest,
    )({
      data: {
        entity_id: "binary_sensor.petlibro_fountain_water_low",
        old_state: { state: "off" },
        new_state: {
          state: "on",
          last_changed: "2026-10-03T12:00:00.000Z",
          last_updated: "2026-10-03T12:00:00.000Z",
          attributes: { problem_detail: "Water below 650 mL" },
        },
      },
    });

    expect(signalWithStart).toHaveBeenCalledTimes(1);
    expect(signalWithStart.mock.calls[0]?.[0]).toBe("petCareAlerts");
    expect(signalWithStart.mock.calls[0]?.[1]).toMatchObject({
      workflowId: "pet-care-alerts",
      signal: "petCareSensorChanged",
      signalArgs: [
        expect.objectContaining({
          entityId: "binary_sensor.petlibro_fountain_water_low",
          state: "on",
          detail: "Water below 650 mL",
          changedAtMs: Date.parse("2026-10-03T12:00:00.000Z"),
        }),
      ],
    });
  });

  test("reconciles all pet-care sensors from HA state on bridge startup", async () => {
    const signalWithStart = vi.fn<WorkflowSignalWithStart>(() =>
      Promise.resolve(),
    );
    const client = fakeSignalClient(signalWithStart);
    const rest = Object.create(null);
    rest.getStates = () =>
      Promise.resolve([
        {
          entity_id: "binary_sensor.litter_robot_problem",
          state: "on",
          attributes: { problem_detail: "Litter robot error" },
          last_changed: "2026-10-03T12:00:00.000Z",
          last_updated: "2026-10-03T12:00:00.000Z",
        },
      ]);

    await syncPetCareStates(client, rest);

    expect(signalWithStart).toHaveBeenCalledTimes(6);
    expect(
      signalWithStart.mock.calls.some(
        ([, options]) =>
          options.signalArgs[0]?.state === "unavailable" &&
          options.signalArgs[0]?.entityId ===
            "binary_sensor.litter_robot_stalled",
      ),
    ).toBe(true);
  });
});
