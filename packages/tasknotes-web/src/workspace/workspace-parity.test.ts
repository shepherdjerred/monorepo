import { Priority, RecurrenceBasis } from "@shepherdjerred/facet-protocol";
import { describe, expect, test } from "vitest";
import { parseCapture, type CaptureContext } from "./capture-parser.ts";
import { label, project, section, task, workspace } from "./fixtures.ts";
import { applyLocal } from "#sync/local-projection.ts";
import { parseSavedFilter } from "./saved-filter.ts";
import { taskDraft, taskDraftChanges } from "./task-draft.ts";
import { isoForWallTime, moveTaskSchedule } from "./task-schedule.ts";
import { inverseFor } from "#app/undo.ts";
import { moveTaskTrees, reorderTasks } from "./workspace-commands.ts";
import { workspaceSearch } from "./workspace.ts";

const today = "2026-11-25";
const timeZone = "America/Los_Angeles";
const data = workspace({
  projects: [
    project({ id: "inbox", name: "Inbox", is_inbox: true }),
    project({ id: "work", name: "Client Work" }),
  ],
  sections: [section({ id: "review", name: "Review", project_id: "work" })],
  labels: [label({ id: "urgent", name: "Urgent" })],
});
const context: CaptureContext = {
  today,
  timeZone,
  data,
  destination: { kind: "section", section: "today" },
};

describe("Facet browser workflows", () => {
  test("quick capture recognizes schedule, repeat basis, deadline, project, section and labels", () => {
    const parsed = parseCapture(
      'Review brief #"Client Work"/Review tomorrow at 9am {Friday} every! 2 weeks p1 @urgent @new',
      context,
    );
    expect(parsed.args).toMatchObject({
      title: "Review brief",
      project_id: "work",
      section_id: "review",
      due_date: "2026-11-26",
      due_datetime: "2026-11-26T17:00:00.000Z",
      due_timezone: timeZone,
      deadline: "2026-11-27",
      recurrence_rule: "FREQ=WEEKLY;INTERVAL=2",
      recurrence_basis: RecurrenceBasis.Completion,
      priority: Priority.P1,
      label_ids: ["urgent"],
    });
    expect(parsed.newLabels).toEqual(["new"]);
  });

  test("capture uses Upcoming context and keeps an opted-out phrase in the title", () => {
    const parsed = parseCapture(
      "Discuss tomorrow",
      {
        ...context,
        destination: { kind: "section", section: "upcoming" },
        upcomingDay: "2026-12-03",
      },
      new Set(["tomorrow"]),
    );
    expect(parsed.args).toMatchObject({
      title: "Discuss tomorrow",
      due_date: "2026-12-03",
    });
  });

  test("workspace search finds subtask notes and offers completed results explicitly", () => {
    const tasks = [
      task({
        id: "child",
        title: "Check venue",
        parent_id: "parent",
        description: "Réunion",
      }),
      task({ id: "finished", title: "Reunion", completed: true }),
    ];
    expect(
      workspaceSearch({ ...data, tasks }, "reunion", false).tasks.map(
        (item) => item.id,
      ),
    ).toEqual(["child"]);
    expect(
      workspaceSearch({ ...data, tasks }, "reunion", true).tasks.map(
        (item) => item.id,
      ),
    ).toEqual(["child", "finished"]);
  });

  test("saved filters support boolean precedence and combined taxonomy conditions", () => {
    const match = parseSavedFilter(
      "(today | overdue) AND #Client Work @urgent",
    );
    const result = task({
      id: "task",
      title: "Review",
      project_id: "work",
      label_ids: ["urgent"],
      due_date: today,
    });
    expect(match.matches(result, context)).toBe(true);
    expect(match.matches({ ...result, label_ids: [] }, context)).toBe(false);
    expect(() => parseSavedFilter("deadline before: 2026-02-30")).toThrow(
      "YYYY-MM-DD",
    );
  });

  test("moving parent tasks preserves descendant links and clears an old section", () => {
    const root = task({
      id: "parent",
      title: "Root",
      project_id: "old",
      section_id: "old-section",
      parent_id: "outside-branch",
    });
    const child = task({
      id: "child",
      title: "Child",
      project_id: "old",
      parent_id: root.id,
      child_order: 1,
    });
    const tasks = moveTaskTrees([root, child], [root.id, child.id], "work", "");
    expect(tasks).toEqual([
      {
        id: root.id,
        project_id: "work",
        child_order: 0,
      },
      {
        id: child.id,
        project_id: "work",
        parent_id: root.id,
        child_order: 1,
      },
    ]);
    const moved = applyLocal(
      workspace({ tasks: [root, child] }),
      {
        uuid: "move",
        command: { type: "TaskMove", args: { tasks } },
      },
      root.updated_at,
    );
    expect(moved.tasks[0]).not.toHaveProperty("section_id");
    expect(moved.tasks[0]).not.toHaveProperty("parent_id");
    expect(moved.tasks[1]).toMatchObject({
      parent_id: root.id,
      child_order: 1,
    });
    expect(moved.tasks[1]).not.toHaveProperty("section_id");
  });

  test("manual ordering rebases positions in one atomic move", () => {
    const first = task({
      id: "first",
      title: "First",
      project_id: "work",
      section_id: "review",
      child_order: 10,
    });
    const second = task({
      id: "second",
      title: "Second",
      project_id: "work",
      section_id: "review",
      child_order: 20,
    });
    expect(reorderTasks([first, second], 1, 0)).toEqual([
      {
        id: "second",
        project_id: "work",
        section_id: "review",
        child_order: 0,
      },
      {
        id: "first",
        project_id: "work",
        section_id: "review",
        child_order: 1,
      },
    ]);
    expect(reorderTasks([first, second], 0, -1)).toEqual([]);
  });

  test("rescheduling retains wall time across DST and draft patches retain untouched fields", () => {
    const timed = task({
      id: "timed",
      title: "Timed",
      due_date: "2026-03-07",
      due_datetime: "2026-03-07T17:00:00.000Z",
      due_timezone: timeZone,
    });
    expect(moveTaskSchedule(timed, "2026-03-09", timeZone)).toMatchObject({
      due_date: "2026-03-09",
      due_datetime: "2026-03-09T16:00:00.000Z",
    });
    expect(isoForWallTime("2026-03-08", "02:30", timeZone)).toBe(
      "2026-03-08T10:30:00.000Z",
    );
    const before = taskDraft(timed, timeZone);
    expect(
      taskDraftChanges(
        { ...timed, description: "From another device" },
        { ...before, title: "Changed" },
        timeZone,
        before,
      ),
    ).toEqual({ id: timed.id, title: "Changed" });
  });
});

test("undo restores the prior section and ordering, with omitted relationships cleared", () => {
  const first = task({
    id: "first",
    title: "First",
    project_id: "work",
    child_order: 4,
  });
  const second = task({
    id: "second",
    title: "Second",
    project_id: "work",
    section_id: "review",
    child_order: 8,
  });
  expect(
    inverseFor(
      {
        type: "TaskMove",
        args: { tasks: reorderTasks([first, second], 1, 0) },
      },
      [first, second],
    ),
  ).toEqual({
    label: "Tasks moved",
    commands: [
      {
        type: "TaskMove",
        args: {
          tasks: [
            { id: first.id, project_id: "work", child_order: 4 },
            {
              id: second.id,
              project_id: "work",
              section_id: "review",
              child_order: 8,
            },
          ],
        },
      },
    ],
  });
});
