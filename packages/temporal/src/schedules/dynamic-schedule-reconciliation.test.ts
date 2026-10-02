import { expect, test, vi } from "vitest";
import { ScheduleNotFoundError } from "@temporalio/client";
import { reconcileDynamicAgentTaskSchedules } from "./register-schedules.ts";

const bootstrap = { environment: "dev", releaseCommit: "test" } as const;

function scheduleClient(error: Error) {
  const updated: string[] = [];
  return {
    updated,
    list: async function* () {
      yield { scheduleId: "agent-task-deleted" };
      yield { scheduleId: "agent-task-survivor" };
    },
    getHandle: (id: string) => ({
      update: async () => {
        if (id === "agent-task-deleted") throw error;
        updated.push(id);
      },
    }),
  };
}

test("a schedule deleted between list and update does not block its survivors", async () => {
  const client = scheduleClient(
    new ScheduleNotFoundError("deleted", "agent-task-deleted"),
  );
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {
    // Suppress expected startup logs in this regression test.
  });
  try {
    await reconcileDynamicAgentTaskSchedules(client, new Set(), bootstrap);
    expect(client.updated).toEqual(["agent-task-survivor"]);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("disappeared"),
    );
  } finally {
    warning.mockRestore();
  }
});

test("authorization or transport failures still fail reconciliation", async () => {
  const failure = new Error("permission denied");
  const client = scheduleClient(failure);
  await expect(
    reconcileDynamicAgentTaskSchedules(client, new Set(), bootstrap),
  ).rejects.toBe(failure);
  expect(client.updated).toEqual([]);
});
