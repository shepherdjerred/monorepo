import { expect, test } from "vitest";
import { InMemoryFacetStore } from "../v1/in-memory-store.ts";
import { executeSync } from "../v1/sync.ts";

function move(uuid: string, ids: string[]) {
  return {
    uuid,
    command: {
      type: "TaskReschedule",
      args: {
        tasks: ids.map((id) => ({ id, due_date: "2026-04-03" })),
      },
    },
  };
}

test("a group reschedule is atomic, resolves temporary IDs and is idempotent", async () => {
  const store = new InMemoryFacetStore();
  const user = "personal-user";
  const adds = ["a", "b"].map((key) => ({
    uuid: key,
    temp_id: key,
    command: { type: "TaskAdd", args: { title: key, due_date: "2026-01-01" } },
  }));
  const failed = await executeSync(store, user, {
    commands: [...adds, move("invalid", ["a", "b", "absent"])],
  });
  expect(failed.sync_status["invalid"]).toContain("error");
  expect(failed.tasks.map((task) => task.due_date)).toEqual([
    "2026-01-01",
    "2026-01-01",
  ]);
  const commands = [...adds, move("valid", ["a", "b"])];
  const moved = await executeSync(store, user, { commands });
  expect(moved.sync_status["valid"]).toBe("ok");
  expect(moved.tasks.map((task) => task.due_date)).toEqual([
    "2026-04-03",
    "2026-04-03",
  ]);
  const replayed = await executeSync(store, user, { commands });
  expect(replayed.sync_token).toBe(moved.sync_token);
});
