import { describe, expect, test } from "bun:test";

import { TaskSchema } from "../../domain/schemas";
import {
  buildTaskDetailPatch,
  createTaskDetailDraft,
  formatTaskMinutes,
  rebaseTaskDetailDraft,
  taskDetailDraftIsDirty,
} from "./task-detail-draft";

function makeTask() {
  return TaskSchema.parse({
    id: "Tasks/example.md",
    path: "Tasks/example.md",
    title: "Plan launch",
    status: "open",
    priority: "high",
    due: "2026-08-12",
    scheduled: "2026-08-10",
    projects: ["[[Projects/Work]]"],
    contexts: ["desk"],
    tags: ["launch"],
    recurrence: "DTSTART:20260810;FREQ=WEEKLY;BYDAY=MO",
    recurrenceAnchor: "completion",
    timeEstimate: 90,
    totalTrackedTime: 35,
    details: "Keep **Markdown** intact.",
  });
}

describe("task detail draft", () => {
  test("round-trips every editable field without producing a patch", () => {
    const task = makeTask();
    const draft = createTaskDetailDraft(task);

    expect(buildTaskDetailPatch(task, draft)).toEqual({ ok: true, patch: {} });
    expect(taskDetailDraftIsDirty(task, draft)).toBe(false);
  });

  test("builds a minimal patch and preserves fields outside the editor", () => {
    const task = makeTask();
    const draft = {
      ...createTaskDetailDraft(task),
      title: "Plan public launch",
      scheduled: null,
      contexts: ["desk", "calls"],
      timeEstimate: "120",
    };

    expect(buildTaskDetailPatch(task, draft)).toEqual({
      ok: true,
      patch: {
        title: "Plan public launch",
        scheduled: null,
        contexts: ["desk", "calls"],
        timeEstimate: 120,
      },
    });
    expect(taskDetailDraftIsDirty(task, draft)).toBe(true);
  });

  test("clears nullable fields explicitly", () => {
    const task = makeTask();
    const draft = {
      ...createTaskDetailDraft(task),
      details: "",
      recurrence: "",
      timeEstimate: "",
    };

    expect(buildTaskDetailPatch(task, draft)).toEqual({
      ok: true,
      patch: {
        details: null,
        recurrence: null,
        recurrenceAnchor: null,
        timeEstimate: null,
      },
    });
  });

  test("adds a recurrence anchor when recurrence is newly configured", () => {
    const task = TaskSchema.parse({ id: "new.md", title: "Repeat me" });
    const draft = {
      ...createTaskDetailDraft(task),
      recurrence: "FREQ=MONTHLY",
      recurrenceAnchor: "completion" as const,
    };

    expect(buildTaskDetailPatch(task, draft)).toEqual({
      ok: true,
      patch: {
        recurrence: "FREQ=MONTHLY",
        recurrenceAnchor: "completion",
      },
    });
  });

  test("rejects invalid drafts instead of sending lossy values", () => {
    const task = makeTask();

    expect(
      buildTaskDetailPatch(task, {
        ...createTaskDetailDraft(task),
        title: "   ",
      }),
    ).toEqual({
      ok: false,
      field: "title",
      message: "Title is required",
    });

    expect(
      buildTaskDetailPatch(task, {
        ...createTaskDetailDraft(task),
        timeEstimate: "later",
      }),
    ).toEqual({
      ok: false,
      field: "timeEstimate",
      message: "Estimate must be a non-negative number of minutes",
    });

    expect(
      buildTaskDetailPatch(task, {
        ...createTaskDetailDraft(task),
        recurrence: "every week",
      }),
    ).toEqual({
      ok: false,
      field: "recurrence",
      message: "Choose a supported repeat schedule",
    });
  });

  test("rebases untouched fields without losing a draft after live updates or ID remaps", () => {
    const task = makeTask();
    const draft = {
      ...createTaskDetailDraft(task),
      details: "Local draft details",
    };
    const updatedTask = TaskSchema.parse({
      ...task,
      id: "TaskNotes/acknowledged.md",
      path: "TaskNotes/acknowledged.md",
      title: "Renamed in Obsidian",
      priority: "low",
      contexts: ["remote"],
    });

    const rebased = rebaseTaskDetailDraft(task, updatedTask, draft);

    expect(rebased.title).toBe("Renamed in Obsidian");
    expect(rebased.priority).toBe("low");
    expect(rebased.contexts).toEqual(["remote"]);
    expect(rebased.details).toBe("Local draft details");
    expect(buildTaskDetailPatch(updatedTask, rebased)).toEqual({
      ok: true,
      patch: { details: "Local draft details" },
    });
  });

  test("preserves empty optional values and a zero-minute estimate", () => {
    const task = TaskSchema.parse({
      id: "empty.md",
      title: "Keep empty values",
      details: "",
      recurrence: "",
      timeEstimate: 0,
    });

    expect(buildTaskDetailPatch(task, createTaskDetailDraft(task))).toEqual({
      ok: true,
      patch: {},
    });
  });
});

describe("formatTaskMinutes", () => {
  test("formats minute and hour durations for direct metadata rows", () => {
    expect(formatTaskMinutes(35)).toBe("35m");
    expect(formatTaskMinutes(60)).toBe("1h");
    expect(formatTaskMinutes(95)).toBe("1h 35m");
  });

  test("fails loudly for invalid task data", () => {
    expect(() => formatTaskMinutes(Number.NaN)).toThrow();
    expect(() => formatTaskMinutes(-1)).toThrow();
  });
});
