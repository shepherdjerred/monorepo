import { describe, expect, test } from "bun:test";

import { parseTaskInput } from "../nlp/parser.ts";

function toISODate(date: Date): string {
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

describe("parseTaskInput - context parsing", () => {
  test("extracts single context with @prefix", () => {
    const result = parseTaskInput("Call dentist @home");
    expect(result.title).toBe("Call dentist");
    expect(result.contexts).toEqual(["home"]);
  });

  test("extracts multiple contexts", () => {
    const result = parseTaskInput("Check email @work @computer");
    expect(result.title).toBe("Check email");
    expect(result.contexts).toEqual(["work", "computer"]);
  });

  test("treats bare @ as title text", () => {
    const result = parseTaskInput("Meet @");
    expect(result.title).toBe("Meet @");
    expect(result.contexts).toBeUndefined();
  });
});

describe("parseTaskInput - project parsing", () => {
  test("extracts single project with p:prefix", () => {
    const result = parseTaskInput("Deploy app p:Backend");
    expect(result.title).toBe("Deploy app");
    expect(result.projects).toEqual(["Backend"]);
  });

  test("extracts multiple projects", () => {
    const result = parseTaskInput("Shared code p:Frontend p:Backend");
    expect(result.title).toBe("Shared code");
    expect(result.projects).toEqual(["Frontend", "Backend"]);
  });

  test("treats bare p: as title text", () => {
    const result = parseTaskInput("Task p:");
    expect(result.title).toBe("Task p:");
    expect(result.projects).toBeUndefined();
  });
});

describe("parseTaskInput - tag parsing", () => {
  test("extracts single tag with #prefix", () => {
    const result = parseTaskInput("Read book #important");
    expect(result.title).toBe("Read book");
    expect(result.tags).toEqual(["important"]);
  });

  test("extracts multiple tags", () => {
    const result = parseTaskInput("Review PR #code #review");
    expect(result.title).toBe("Review PR");
    expect(result.tags).toEqual(["code", "review"]);
  });

  test("treats bare # as title text", () => {
    const result = parseTaskInput("Task #");
    expect(result.title).toBe("Task #");
    expect(result.tags).toBeUndefined();
  });
});

describe("parseTaskInput - priority parsing", () => {
  test("extracts !highest priority", () => {
    const result = parseTaskInput("Critical issue !highest");
    expect(result.title).toBe("Critical issue");
    expect(result.priority).toBe("highest");
  });

  test("extracts !high priority", () => {
    const result = parseTaskInput("Bug fix !high");
    expect(result.title).toBe("Bug fix");
    expect(result.priority).toBe("high");
  });

  test("extracts !medium priority", () => {
    const result = parseTaskInput("Refactor code !medium");
    expect(result.title).toBe("Refactor code");
    expect(result.priority).toBe("medium");
  });

  test("extracts !low priority", () => {
    const result = parseTaskInput("Nice to have !low");
    expect(result.title).toBe("Nice to have");
    expect(result.priority).toBe("low");
  });

  test("extracts !none priority", () => {
    const result = parseTaskInput("No priority !none");
    expect(result.title).toBe("No priority");
    expect(result.priority).toBe("none");
  });

  test("extracts !1 as highest", () => {
    const result = parseTaskInput("Urgent !1");
    expect(result.title).toBe("Urgent");
    expect(result.priority).toBe("highest");
  });

  test("extracts !2 as high", () => {
    const result = parseTaskInput("Important !2");
    expect(result.title).toBe("Important");
    expect(result.priority).toBe("high");
  });

  test("extracts !3 as medium", () => {
    const result = parseTaskInput("Normal !3");
    expect(result.title).toBe("Normal");
    expect(result.priority).toBe("medium");
  });

  test("extracts !4 as low", () => {
    const result = parseTaskInput("Low prio !4");
    expect(result.title).toBe("Low prio");
    expect(result.priority).toBe("low");
  });

  test("priority is case-insensitive", () => {
    const result = parseTaskInput("Task !HIGH");
    expect(result.priority).toBe("high");
  });
});

describe("parseTaskInput - date words", () => {
  test("resolves 'today' to today's date", () => {
    const result = parseTaskInput("Meeting today");
    expect(result.title).toBe("Meeting");
    expect(result.due).toBe(toISODate(new Date()));
  });

  test("resolves 'tomorrow' to tomorrow's date", () => {
    const expected = new Date();
    expected.setDate(expected.getDate() + 1);
    const result = parseTaskInput("Appointment tomorrow");
    expect(result.title).toBe("Appointment");
    expect(result.due).toBe(toISODate(expected));
  });

  test("resolves 'monday' to next monday", () => {
    const result = parseTaskInput("Meeting monday");
    expect(result.title).toBe("Meeting");
    expect(result.due).toBeDefined();
    expect(result.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Verify it's actually a Monday
    const date = new Date(`${String(result.due)}T00:00:00`);
    expect(date.getDay()).toBe(1);
  });

  test("resolves 'friday' to next friday", () => {
    const result = parseTaskInput("Deadline friday");
    expect(result.title).toBe("Deadline");
    expect(result.due).toBeDefined();
    const date = new Date(`${String(result.due)}T00:00:00`);
    expect(date.getDay()).toBe(5);
  });

  test("resolves 'sunday' to next sunday", () => {
    const result = parseTaskInput("Rest sunday");
    expect(result.title).toBe("Rest");
    expect(result.due).toBeDefined();
    const date = new Date(`${String(result.due)}T00:00:00`);
    expect(date.getDay()).toBe(0);
  });

  test("date words are case-insensitive", () => {
    const result = parseTaskInput("Task TODAY");
    expect(result.due).toBe(toISODate(new Date()));
  });
});

describe("parseTaskInput - 'next week'", () => {
  test("resolves 'next week' to 7 days from now", () => {
    const expected = new Date();
    expected.setDate(expected.getDate() + 7);
    const result = parseTaskInput("Review PR next week");
    expect(result.title).toBe("Review PR");
    expect(result.due).toBe(toISODate(expected));
  });

  test("handles 'next week' at end of input", () => {
    const result = parseTaskInput("Plan sprint next week");
    expect(result.title).toBe("Plan sprint");
    expect(result.due).toBeDefined();
  });

  test("handles 'next week' with other metadata", () => {
    const expected = new Date();
    expected.setDate(expected.getDate() + 7);
    const result = parseTaskInput("Deploy !high p:Backend next week");
    expect(result.title).toBe("Deploy");
    expect(result.priority).toBe("high");
    expect(result.projects).toEqual(["Backend"]);
    expect(result.due).toBe(toISODate(expected));
  });
});

describe("parseTaskInput - combined metadata", () => {
  test("extracts all metadata types at once", () => {
    const result = parseTaskInput(
      "Write tests !high p:Backend @work #urgent today",
    );
    expect(result.title).toBe("Write tests");
    expect(result.priority).toBe("high");
    expect(result.projects).toEqual(["Backend"]);
    expect(result.contexts).toEqual(["work"]);
    expect(result.tags).toEqual(["urgent"]);
    expect(result.due).toBe(toISODate(new Date()));
  });

  test("handles metadata in any order", () => {
    const result = parseTaskInput("@work !2 #review p:Frontend Fix button");
    expect(result.title).toBe("Fix button");
    expect(result.contexts).toEqual(["work"]);
    expect(result.priority).toBe("high");
    expect(result.tags).toEqual(["review"]);
    expect(result.projects).toEqual(["Frontend"]);
  });
});

describe("parseTaskInput - edge cases", () => {
  test("handles empty input", () => {
    const result = parseTaskInput("");
    expect(result.title).toBe("");
  });

  test("handles input with only metadata", () => {
    const result = parseTaskInput("!high @work p:Project #tag");
    expect(result.title).toBe("");
    expect(result.priority).toBe("high");
    expect(result.contexts).toEqual(["work"]);
    expect(result.projects).toEqual(["Project"]);
    expect(result.tags).toEqual(["tag"]);
  });

  test("handles input with extra whitespace", () => {
    const result = parseTaskInput("  Buy   groceries   !high  ");
    expect(result.title).toBe("Buy groceries");
    expect(result.priority).toBe("high");
  });

  test("unknown !word is treated as title text", () => {
    const result = parseTaskInput("Say !hello to team");
    expect(result.title).toBe("Say !hello to team");
    expect(result.priority).toBeUndefined();
  });

  test("omits empty optional fields from result", () => {
    const result = parseTaskInput("Simple task");
    expect(result.title).toBe("Simple task");
    expect(result.due).toBeUndefined();
    expect(result.priority).toBeUndefined();
    expect(result.projects).toBeUndefined();
    expect(result.contexts).toBeUndefined();
    expect(result.tags).toBeUndefined();
  });
});
