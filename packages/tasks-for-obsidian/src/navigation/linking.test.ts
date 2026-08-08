import { describe, expect, test } from "bun:test";
import { getStateFromPath } from "@react-navigation/core";

import { linking } from "./linking";

function stateFor(path: string) {
  const state = getStateFromPath(path, linking.config);
  if (state === undefined) throw new Error(`No navigation state for ${path}`);
  return state;
}

describe("deep-link navigation state", () => {
  test("prepends Main for cold-start sheet and detail destinations", () => {
    expect(stateFor("quick-add").routes.map((route) => route.name)).toEqual([
      "Main",
      "QuickAdd",
    ]);
    expect(
      stateFor("task/TaskNotes%2Ftask.md").routes.map((route) => route.name),
    ).toEqual(["Main", "TaskDetail"]);
  });

  test("decodes path IDs once while rejecting traversal", () => {
    const pathId = stateFor("task/TaskNotes%2Ftask.md").routes[1];
    expect(pathId?.params).toEqual({ taskId: "TaskNotes/task.md" });

    const traversal = stateFor("task/..%2Fsecret.md").routes[1];
    expect(traversal?.params).toEqual({ taskId: "" });
  });

  test("recovers malformed Upcoming query dates to no selected day", () => {
    const main = stateFor("upcoming?selectedDay=2026-99-99").routes[0];
    expect(main?.state?.routes[0]?.params).toEqual({ selectedDay: null });
  });
});
