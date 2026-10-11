import { expect, test } from "vitest";
import { assertOfficialTask } from "./official-ui";

const task = (status: string, date: string) =>
  new TextEncoder().encode(
    `---\ntitle: Synthetic owned task\nstatus: ${status}\n${date}---\nSynthetic body.\n`,
  );
test("official owner checkpoints require exact title and completion semantics", () => {
  expect(() =>
    assertOfficialTask(task("open", ""), "Synthetic owned task", false),
  ).not.toThrow();
  expect(() =>
    assertOfficialTask(
      task("done", "completedDate: 2026-10-11\n"),
      "Synthetic owned task",
      true,
    ),
  ).not.toThrow();
  expect(() =>
    assertOfficialTask(task("open", ""), "Different task", false),
  ).toThrow();
  expect(() =>
    assertOfficialTask(task("done", ""), "Synthetic owned task", true),
  ).toThrow("completion date");
  expect(() =>
    assertOfficialTask(
      task("open", "completedDate: 2026-10-11\n"),
      "Synthetic owned task",
      false,
    ),
  ).toThrow("completion date");
});
