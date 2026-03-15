import { describe, expect, test } from "bun:test";

import { frontmatterToTask, taskToFrontmatter } from "../vault/task-mapper.ts";
import type { Task } from "../domain/types.ts";

describe("frontmatterToTask", () => {
  test("parses valid frontmatter data", () => {
    const data = {
      id: "abc123",
      title: "Test task",
      status: "open",
      priority: "high",
      due: "2026-03-01",
      contexts: ["home"],
      projects: ["MyProject"],
      tags: ["urgent"],
    };

    const task = frontmatterToTask(data, "Description here", "tasks/test.md");
    expect(task).toBeDefined();
    expect(task!.id).toBe("abc123");
    expect(task!.title).toBe("Test task");
    expect(task!.status).toBe("open");
    expect(task!.priority).toBe("high");
    expect(task!.due).toBe("2026-03-01");
    expect(task!.contexts).toEqual(["home"]);
    expect(task!.projects).toEqual(["MyProject"]);
    expect(task!.tags).toEqual(["urgent"]);
    expect(task!.details).toBe("Description here");
    expect(task!.path).toBe("tasks/test.md");
  });

  test("uses defaults for missing fields", () => {
    const data = { id: "xyz", title: "Minimal" };
    const task = frontmatterToTask(data, "", "test.md");
    expect(task).toBeDefined();
    expect(task!.status).toBe("open");
    expect(task!.priority).toBe("normal");
    expect(task!.contexts).toEqual([]);
    expect(task!.projects).toEqual([]);
    expect(task!.tags).toEqual([]);
    expect(task!.archived).toBe(false);
    expect(task!.totalTrackedTime).toBe(0);
    expect(task!.completeInstances).toEqual([]);
    expect(task!.skippedInstances).toEqual([]);
    expect(task!.timeEntries).toEqual([]);
    expect(task!.blockedBy).toEqual([]);
    expect(task!.reminders).toEqual([]);
    expect(task!.extraFields).toEqual({});
    expect(task!.details).toBeUndefined();
  });

  test("derives id from path when id is missing", () => {
    const data = { title: "No ID" };
    const task = frontmatterToTask(data, "", "Tasks/clean-washer.md");
    expect(task).toBeDefined();
    expect(task!.id).toBe("tasks-clean-washer");
    expect(task!.title).toBe("No ID");
  });

  test("derives id from nested path when id is missing", () => {
    const data = { title: "Nested task", status: "open" };
    const task = frontmatterToTask(
      data,
      "",
      "TaskNotes/Tasks/Job Search 2026/apply-google.md",
    );
    expect(task).toBeDefined();
    expect(task!.id).toBe("tasknotes-tasks-job-search-2026-apply-google");
  });

  test("returns undefined for missing title", () => {
    const data = { id: "abc" };
    const task = frontmatterToTask(data, "", "test.md");
    expect(task).toBeUndefined();
  });

  test("parses recurrence fields", () => {
    const data = {
      title: "Pay rent",
      recurrence: "DTSTART:20260301;FREQ=MONTHLY;BYMONTHDAY=1",
      recurrence_anchor: "scheduled",
      complete_instances: ["2026-03-03", "2026-03-14"],
      skipped_instances: ["2026-02-01"],
    };
    const task = frontmatterToTask(data, "", "test.md");
    expect(task).toBeDefined();
    expect(task!.recurrence).toBe(
      "DTSTART:20260301;FREQ=MONTHLY;BYMONTHDAY=1",
    );
    expect(task!.recurrenceAnchor).toBe("scheduled");
    expect(task!.completeInstances).toEqual(["2026-03-03", "2026-03-14"]);
    expect(task!.skippedInstances).toEqual(["2026-02-01"]);
  });

  test("parses timestamp fields", () => {
    const data = {
      title: "Timestamped",
      completedDate: "2026-03-09T10:00:00Z",
      dateCreated: "2026-02-24T10:00:00Z",
      dateModified: "2026-03-15T11:21:34.930-07:00",
    };
    const task = frontmatterToTask(data, "", "test.md");
    expect(task).toBeDefined();
    expect(task!.completedDate).toBe("2026-03-09T10:00:00Z");
    expect(task!.dateCreated).toBe("2026-02-24T10:00:00Z");
    expect(task!.dateModified).toBe("2026-03-15T11:21:34.930-07:00");
  });

  test("parses blockedBy and reminders", () => {
    const data = {
      title: "Blocked task",
      blockedBy: [{ uid: "[[Other Task]]", reltype: "FINISHTOSTART" }],
      reminders: [{ type: "relative", offset: "-PT15M", relatedTo: "due" }],
    };
    const task = frontmatterToTask(data, "", "test.md");
    expect(task).toBeDefined();
    expect(task!.blockedBy).toEqual([
      { uid: "[[Other Task]]", reltype: "FINISHTOSTART" },
    ]);
    expect(task!.reminders).toEqual([
      { type: "relative", offset: "-PT15M", relatedTo: "due" },
    ]);
  });

  test("parses calendar sync fields", () => {
    const data = {
      title: "Synced task",
      googleCalendarEventId: "gcal-123",
      icsEventId: "ics-456",
    };
    const task = frontmatterToTask(data, "", "test.md");
    expect(task).toBeDefined();
    expect(task!.googleCalendarEventId).toBe("gcal-123");
    expect(task!.icsEventId).toBe("ics-456");
  });

  test("collects unknown fields into extraFields", () => {
    const data = {
      title: "Job app",
      status: "open",
      company_status: "applied",
      URL: "https://example.com/apply",
      contact_email: "hr@company.com",
    };
    const task = frontmatterToTask(data, "", "test.md");
    expect(task).toBeDefined();
    expect(task!.extraFields).toEqual({
      company_status: "applied",
      URL: "https://example.com/apply",
      contact_email: "hr@company.com",
    });
  });

  test("parses timeEstimate and timeEntries", () => {
    const data = {
      title: "Timed task",
      timeEstimate: 30,
      timeEntries: [
        {
          startTime: "2026-03-15T10:00:00Z",
          endTime: "2026-03-15T10:30:00Z",
          duration: 1800,
        },
      ],
    };
    const task = frontmatterToTask(data, "", "test.md");
    expect(task).toBeDefined();
    expect(task!.timeEstimate).toBe(30);
    expect(task!.timeEntries).toEqual([
      {
        startTime: "2026-03-15T10:00:00Z",
        endTime: "2026-03-15T10:30:00Z",
        duration: 1800,
      },
    ]);
  });
});

describe("taskToFrontmatter", () => {
  const baseTask: Task = {
    id: "abc123",
    path: "tasks/test.md",
    title: "Test task",
    status: "open",
    priority: "high",
    due: "2026-03-01",
    scheduled: undefined,
    contexts: ["home"],
    projects: ["MyProject"],
    tags: ["urgent"],
    recurrence: undefined,
    recurrenceAnchor: undefined,
    completeInstances: [],
    skippedInstances: [],
    completedDate: undefined,
    dateCreated: undefined,
    dateModified: undefined,
    timeEstimate: undefined,
    timeEntries: [],
    blockedBy: [],
    reminders: [],
    archived: false,
    totalTrackedTime: 0,
    isBlocked: false,
    isBlocking: false,
    googleCalendarEventId: undefined,
    icsEventId: undefined,
    extraFields: {},
    details: "Task body",
  };

  test("converts task to frontmatter", () => {
    const { data, content } = taskToFrontmatter(baseTask);
    expect(data["id"]).toBe("abc123");
    expect(data["title"]).toBe("Test task");
    expect(data["status"]).toBe("open");
    expect(data["priority"]).toBe("high");
    expect(data["due"]).toBe("2026-03-01");
    expect(data["contexts"]).toEqual(["home"]);
    expect(data["projects"]).toEqual(["MyProject"]);
    expect(data["tags"]).toEqual(["urgent"]);
    expect(content).toBe("Task body");
  });

  test("omits undefined optional fields", () => {
    const minimal: Task = {
      ...baseTask,
      due: undefined,
      contexts: [],
      projects: [],
      tags: [],
    };
    const { data } = taskToFrontmatter(minimal);
    expect(data["due"]).toBeUndefined();
    expect(data["scheduled"]).toBeUndefined();
    expect(data["contexts"]).toBeUndefined();
    expect(data["projects"]).toBeUndefined();
    expect(data["tags"]).toBeUndefined();
    expect(data["recurrence"]).toBeUndefined();
    expect(data["recurrence_anchor"]).toBeUndefined();
    expect(data["complete_instances"]).toBeUndefined();
    expect(data["skipped_instances"]).toBeUndefined();
    expect(data["archived"]).toBeUndefined();
  });

  test("serializes recurrence fields", () => {
    const task: Task = {
      ...baseTask,
      recurrence: "DTSTART:20260301;FREQ=MONTHLY",
      recurrenceAnchor: "completion",
      completeInstances: ["2026-03-03"],
      skippedInstances: ["2026-02-01"],
    };
    const { data } = taskToFrontmatter(task);
    expect(data["recurrence"]).toBe("DTSTART:20260301;FREQ=MONTHLY");
    expect(data["recurrence_anchor"]).toBe("completion");
    expect(data["complete_instances"]).toEqual(["2026-03-03"]);
    expect(data["skipped_instances"]).toEqual(["2026-02-01"]);
  });

  test("serializes extraFields into frontmatter", () => {
    const task: Task = {
      ...baseTask,
      extraFields: {
        company_status: "applied",
        URL: "https://example.com",
      },
    };
    const { data } = taskToFrontmatter(task);
    expect(data["company_status"]).toBe("applied");
    expect(data["URL"]).toBe("https://example.com");
  });

  test("round-trips all fields", () => {
    const original = {
      id: "rt-test",
      title: "Round trip",
      status: "in-progress",
      priority: "high",
      due: "2026-04-01",
      scheduled: "2026-03-28",
      contexts: ["work"],
      projects: ["[[Big Project]]"],
      tags: ["task", "important"],
      recurrence: "DTSTART:20260401;FREQ=WEEKLY",
      recurrence_anchor: "completion",
      complete_instances: ["2026-03-01", "2026-03-08"],
      skipped_instances: ["2026-03-15"],
      completedDate: "2026-03-08T17:00:00Z",
      dateCreated: "2026-02-20T09:00:00Z",
      dateModified: "2026-03-08T17:00:00Z",
      timeEstimate: 45,
      blockedBy: [
        { uid: "[[Setup]]", reltype: "FINISHTOSTART", gap: "P1D" },
      ],
      reminders: [{ type: "relative" as const, offset: "-PT1H", relatedTo: "due" }],
      archived: false,
      totalTrackedTime: 3600,
      isBlocked: true,
      isBlocking: false,
      googleCalendarEventId: "gcal-abc",
      company_status: "screener",
    };

    const task = frontmatterToTask(original, "Body text", "test.md");
    expect(task).toBeDefined();

    const { data, content } = taskToFrontmatter(task!);
    expect(content).toBe("Body text");
    expect(data["recurrence_anchor"]).toBe("completion");
    expect(data["complete_instances"]).toEqual(["2026-03-01", "2026-03-08"]);
    expect(data["skipped_instances"]).toEqual(["2026-03-15"]);
    expect(data["completedDate"]).toBe("2026-03-08T17:00:00Z");
    expect(data["dateCreated"]).toBe("2026-02-20T09:00:00Z");
    expect(data["timeEstimate"]).toBe(45);
    expect(data["googleCalendarEventId"]).toBe("gcal-abc");
    expect(data["company_status"]).toBe("screener");
    expect(data["isBlocked"]).toBe(true);
    expect(data["totalTrackedTime"]).toBe(3600);
  });
});
