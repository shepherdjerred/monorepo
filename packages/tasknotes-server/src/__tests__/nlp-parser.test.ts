import { describe, expect, test } from "bun:test";

import { parseTaskInput } from "../nlp/parser.ts";

describe("parseTaskInput", () => {
  test("extracts plain title", () => {
    const result = parseTaskInput("Buy groceries");
    expect(result.title).toBe("Buy groceries");
    expect(result.due).toBeUndefined();
    expect(result.priority).toBeUndefined();
  });

  test("extracts priority with !high", () => {
    const result = parseTaskInput("Fix bug !high");
    expect(result.title).toBe("Fix bug");
    expect(result.priority).toBe("high");
  });

  test("extracts priority with !1 (highest)", () => {
    const result = parseTaskInput("Urgent task !1");
    expect(result.title).toBe("Urgent task");
    expect(result.priority).toBe("highest");
  });

  test("extracts project with p:prefix", () => {
    const result = parseTaskInput("Deploy app p:MyProject");
    expect(result.title).toBe("Deploy app");
    expect(result.projects).toEqual(["MyProject"]);
  });

  test("extracts context with @prefix", () => {
    const result = parseTaskInput("Call dentist @home");
    expect(result.title).toBe("Call dentist");
    expect(result.contexts).toEqual(["home"]);
  });

  test("extracts tag with #prefix", () => {
    const result = parseTaskInput("Read book #important");
    expect(result.title).toBe("Read book");
    expect(result.tags).toEqual(["important"]);
  });

  test("extracts today date", () => {
    const result = parseTaskInput("Meeting today");
    expect(result.title).toBe("Meeting");
    expect(result.due).toBeDefined();
  });

  test("extracts tomorrow date", () => {
    const result = parseTaskInput("Appointment tomorrow");
    expect(result.title).toBe("Appointment");
    expect(result.due).toBeDefined();
  });

  test("extracts next week", () => {
    const result = parseTaskInput("Review PR next week");
    expect(result.title).toBe("Review PR");
    expect(result.due).toBeDefined();
  });

  test("extracts multiple metadata", () => {
    const result = parseTaskInput("Write tests !high p:Backend @work #urgent today");
    expect(result.title).toBe("Write tests");
    expect(result.priority).toBe("high");
    expect(result.projects).toEqual(["Backend"]);
    expect(result.contexts).toEqual(["work"]);
    expect(result.tags).toEqual(["urgent"]);
    expect(result.due).toBeDefined();
  });

  test("handles empty input", () => {
    const result = parseTaskInput("");
    expect(result.title).toBe("");
  });

  test("extracts day names as due dates", () => {
    const result = parseTaskInput("Meeting monday");
    expect(result.title).toBe("Meeting");
    expect(result.due).toBeDefined();
    expect(result.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
