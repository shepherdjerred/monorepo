import { describe, expect, test } from "bun:test";

import { parseTaskInput } from "./nlp";

function toISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daysFromNow(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return toISO(d);
}

describe("parseTaskInput", () => {
  describe("basic title extraction", () => {
    test("returns full input as title when no special tokens", () => {
      const result = parseTaskInput("Buy groceries");
      expect(result.title).toBe("Buy groceries");
    });

    test("handles empty input", () => {
      const result = parseTaskInput("");
      expect(result.title).toBe("");
    });

    test("handles whitespace-only input", () => {
      const result = parseTaskInput("   ");
      expect(result.title).toBe("");
    });

    test("preserves title words around special tokens", () => {
      const result = parseTaskInput("Call dentist @phone tomorrow");
      expect(result.title).toBe("Call dentist");
    });
  });

  describe("priority parsing", () => {
    test("parses !highest", () => {
      const result = parseTaskInput("Fix bug !highest");
      expect(result.priority).toBe("highest");
      expect(result.title).toBe("Fix bug");
    });

    test("parses !high", () => {
      const result = parseTaskInput("!high Review PR");
      expect(result.priority).toBe("high");
      expect(result.title).toBe("Review PR");
    });

    test("parses !medium", () => {
      const result = parseTaskInput("Clean desk !medium");
      expect(result.priority).toBe("medium");
    });

    test("parses !low", () => {
      const result = parseTaskInput("Organize files !low");
      expect(result.priority).toBe("low");
    });

    test("parses !none", () => {
      const result = parseTaskInput("Someday task !none");
      expect(result.priority).toBe("none");
    });

    test("parses numeric priorities: !1 = highest", () => {
      const result = parseTaskInput("Urgent thing !1");
      expect(result.priority).toBe("highest");
    });

    test("parses numeric priorities: !2 = high", () => {
      const result = parseTaskInput("Important thing !2");
      expect(result.priority).toBe("high");
    });

    test("parses numeric priorities: !3 = medium", () => {
      const result = parseTaskInput("Normal thing !3");
      expect(result.priority).toBe("medium");
    });

    test("parses numeric priorities: !4 = low", () => {
      const result = parseTaskInput("Low thing !4");
      expect(result.priority).toBe("low");
    });

    test("is case-insensitive", () => {
      const result = parseTaskInput("Task !HIGH");
      expect(result.priority).toBe("high");
    });

    test("does not set priority when not provided", () => {
      const result = parseTaskInput("Just a task");
      expect(result.priority).toBeUndefined();
    });
  });

  describe("project parsing", () => {
    test("parses p:ProjectName", () => {
      const result = parseTaskInput("Do thing p:MyProject");
      expect(result.projects).toEqual(["MyProject"]);
      expect(result.title).toBe("Do thing");
    });

    test("parses multiple projects", () => {
      const result = parseTaskInput("Task p:Alpha p:Beta");
      expect(result.projects).toEqual(["Alpha", "Beta"]);
    });

    test("ignores bare p: with no name", () => {
      const result = parseTaskInput("Task p:");
      expect(result.projects).toBeUndefined();
      expect(result.title).toBe("Task p:");
    });
  });

  describe("context parsing", () => {
    test("parses @context", () => {
      const result = parseTaskInput("Call dentist @phone");
      expect(result.contexts).toEqual(["phone"]);
      expect(result.title).toBe("Call dentist");
    });

    test("parses multiple contexts", () => {
      const result = parseTaskInput("Task @home @evening");
      expect(result.contexts).toEqual(["home", "evening"]);
    });

    test("ignores bare @ with no name", () => {
      const result = parseTaskInput("Send @");
      // bare @ is ignored as a context but also becomes a title part
      expect(result.contexts).toBeUndefined();
    });
  });

  describe("tag parsing", () => {
    test("parses #tag", () => {
      const result = parseTaskInput("Review code #urgent");
      expect(result.tags).toEqual(["urgent"]);
      expect(result.title).toBe("Review code");
    });

    test("parses multiple tags", () => {
      const result = parseTaskInput("Task #work #review");
      expect(result.tags).toEqual(["work", "review"]);
    });

    test("ignores bare # with no name", () => {
      const result = parseTaskInput("Task #");
      expect(result.tags).toBeUndefined();
    });
  });

  describe("date parsing", () => {
    test("parses 'today'", () => {
      const result = parseTaskInput("Buy milk today");
      expect(result.due).toBe(toISO(new Date()));
      expect(result.title).toBe("Buy milk");
    });

    test("parses 'tomorrow'", () => {
      const result = parseTaskInput("Submit report tomorrow");
      expect(result.due).toBe(daysFromNow(1));
      expect(result.title).toBe("Submit report");
    });

    test("parses 'next week'", () => {
      const result = parseTaskInput("Plan meeting next week");
      expect(result.due).toBe(daysFromNow(7));
      expect(result.title).toBe("Plan meeting");
    });

    test("parses day names (e.g. monday, friday)", () => {
      const result = parseTaskInput("Call Bob monday");
      expect(result.due).toBeDefined();
      // Should be a valid ISO date
      expect(result.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Should be in the future (or exactly 7 days if today is monday)
      const dueDate = new Date(result.due!);
      expect(dueDate.getDay()).toBe(1); // Monday
    });

    test("is case-insensitive for date words", () => {
      const result = parseTaskInput("Task TODAY");
      expect(result.due).toBe(toISO(new Date()));
    });

    test("does not set due when no date provided", () => {
      const result = parseTaskInput("Just a task");
      expect(result.due).toBeUndefined();
    });
  });

  describe("combined parsing", () => {
    test("parses all fields at once", () => {
      const result = parseTaskInput("Fix login bug !high p:Auth @work #backend tomorrow");
      expect(result.title).toBe("Fix login bug");
      expect(result.priority).toBe("high");
      expect(result.projects).toEqual(["Auth"]);
      expect(result.contexts).toEqual(["work"]);
      expect(result.tags).toEqual(["backend"]);
      expect(result.due).toBe(daysFromNow(1));
    });

    test("tokens can appear in any order", () => {
      const result = parseTaskInput("!1 @home #chores Buy groceries today");
      expect(result.priority).toBe("highest");
      expect(result.contexts).toEqual(["home"]);
      expect(result.tags).toEqual(["chores"]);
      expect(result.title).toBe("Buy groceries");
      expect(result.due).toBe(toISO(new Date()));
    });

    test("only includes defined fields in result", () => {
      const result = parseTaskInput("Simple task");
      expect(Object.keys(result)).toEqual(["title"]);
    });
  });
});
