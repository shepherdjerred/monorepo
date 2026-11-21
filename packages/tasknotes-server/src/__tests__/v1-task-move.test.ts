import { expect, test } from "vitest";
import { InMemoryFacetStore } from "../v1/in-memory-store.ts";
import { executeSync } from "../v1/sync.ts";

test("moves a hierarchy and its orders atomically, rejects stale children, and detaches a child alone", async () => {
  const store = new InMemoryFacetStore();
  const user = "private-user";
  await store.getOrCreateUser(user);
  const [studio, home] = await Promise.all(
    ["Studio", "Home"].map((name) =>
      store.createProject({ userId: user, name }),
    ),
  );
  if (!studio || !home) throw new Error("Missing project fixture");
  const parent = await store.createTask({
    userId: user,
    projectId: studio.id,
    title: "Print",
  });
  const child = await store.createTask({
    userId: user,
    projectId: studio.id,
    title: "Mat",
    parentId: parent.id,
  });
  const moveParent = { id: parent.id, project_id: home.id, child_order: 1 };
  const moveChild = {
    id: child.id,
    project_id: home.id,
    parent_id: parent.id,
    child_order: 2,
  };
  const move = (id: string, tasks: (typeof moveParent)[]) =>
    executeSync(store, user, {
      commands: [{ uuid: id, command: { type: "TaskMove", args: { tasks } } }],
    });
  const rejected = await move("missing-child", [moveParent]);
  expect(rejected.sync_status["missing-child"]).toContain("error");
  const original = await store.getTask(parent.id, user);
  expect(original?.project_id).toBe(studio.id);
  const moved = await move("together", [moveParent, moveChild]);
  expect(moved.sync_status["together"]).toBe("ok");
  const together = await store.getTask(child.id, user);
  expect(together?.parent_id).toBe(parent.id);
  const detach = { ...moveParent, id: child.id, project_id: studio.id };
  const separated = await move("separate", [detach]);
  expect(separated.sync_status["separate"]).toBe("ok");
  const detached = await store.getTask(child.id, user);
  expect(detached?.parent_id).toBeUndefined();
});
