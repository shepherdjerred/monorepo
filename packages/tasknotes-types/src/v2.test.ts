import { describe, expect, test } from "bun:test";
import {
  priorityConfigSchema,
  statusConfigSchema,
  taskInfoSchema,
} from "@tasknotes/model";
import { z } from "zod";

import {
  PriorityConfigV2Schema,
  StatusConfigV2Schema,
  TaskInfoV2Schema,
} from "./v2.ts";

/**
 * The wire schemas are zod-v4 MIRRORS of the model's zod-v3 schemas (the two
 * zod majors cannot type-compose). These tests pin the mirrors key-for-key
 * and optionality-for-optionality against the model's own runtime shapes, so
 * a model version bump that changes the contract fails here instead of
 * silently drifting.
 */

type V3ShapeEntry = {
  isOptional: () => boolean;
};

function v3Shape(schema: unknown): Map<string, V3ShapeEntry> {
  const parsed = z
    .object({ shape: z.record(z.string(), z.unknown()) })
    .loose()
    .parse(schema);
  const entries = new Map<string, V3ShapeEntry>();
  for (const [key, value] of Object.entries(parsed.shape)) {
    const entry = z
      .object({
        isOptional: z.custom<() => boolean>((v) => typeof v === "function"),
      })
      .loose()
      .parse(value);
    entries.set(key, entry);
  }
  return entries;
}

function v4Shape(schema: z.ZodObject): Map<string, { optional: boolean }> {
  const entries = new Map<string, { optional: boolean }>();
  for (const [key, value] of Object.entries(schema.shape)) {
    entries.set(key, { optional: value.safeParse(void 0).success });
  }
  return entries;
}

function assertMirrors(model: unknown, mirror: z.ZodObject, label: string) {
  const expected = v3Shape(model);
  const actual = v4Shape(mirror);
  expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
  for (const [key, entry] of expected) {
    const mirrored = actual.get(key);
    if (mirrored === undefined) throw new Error(`${label}: missing ${key}`);
    expect(`${key}:${String(mirrored.optional)}`).toBe(
      `${key}:${String(entry.isOptional())}`,
    );
  }
}

describe("v2 wire schemas mirror @tasknotes/model", () => {
  test("TaskInfoV2Schema matches taskInfoSchema keys and optionality", () => {
    assertMirrors(taskInfoSchema, TaskInfoV2Schema, "TaskInfo");
  });

  test("StatusConfigV2Schema matches statusConfigSchema", () => {
    assertMirrors(statusConfigSchema, StatusConfigV2Schema, "StatusConfig");
  });

  test("PriorityConfigV2Schema matches priorityConfigSchema", () => {
    assertMirrors(
      priorityConfigSchema,
      PriorityConfigV2Schema,
      "PriorityConfig",
    );
  });

  test("both schema generations accept the same realistic task", () => {
    const task = {
      title: "Water plants",
      status: "open",
      priority: "normal",
      path: "TaskNotes/water-plants.md",
      archived: false,
      tags: ["task"],
      recurrence: "FREQ=DAILY",
      recurrence_anchor: "scheduled",
      complete_instances: ["2026-07-01"],
      timeEntries: [{ startTime: "2026-07-01T09:00:00Z", duration: 30 }],
      blockedBy: [{ uid: "other", reltype: "FINISHTOSTART" }],
      reminders: [{ id: "r1", type: "relative", relatedTo: "due" }],
    };
    const v3 = z
      .object({
        safeParse: z.custom<(input: unknown) => { success: boolean }>(
          (v) => typeof v === "function",
        ),
      })
      .loose()
      .parse(taskInfoSchema);
    expect(v3.safeParse(task).success).toBe(true);
    expect(TaskInfoV2Schema.safeParse(task).success).toBe(true);
  });
});
