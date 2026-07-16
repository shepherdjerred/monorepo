import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  conformanceMetadata,
  executeConformanceOperation,
  resolveModelConfig,
} from "tasknotes-types/v2";

import { TaskRepository } from "../engine/task-repository.ts";

/**
 * Conformance: the server's observable behavior checked against the
 * model's own spec harness (`executeConformanceOperation`) as an
 * INDEPENDENT oracle — not against the code paths the server itself uses.
 * A model upgrade that changes spec semantics fails here with a named
 * operation instead of drifting silently.
 */

const NOW = new Date("2026-07-03T12:00:00.000Z");
const config = resolveModelConfig();

const OkEnvelope = z.object({ ok: z.literal(true), result: z.unknown() });

function run(operation: string, input: Record<string, unknown>): unknown {
  return OkEnvelope.parse(executeConformanceOperation(operation, input)).result;
}

let vault: string;
let repo: TaskRepository;

const RECURRING = `---
title: Water plants
status: open
priority: normal
scheduled: 2026-07-01
recurrence: FREQ=DAILY
tags:
  - task
---
`;

beforeEach(async () => {
  vault = await mkdtemp(path.join(tmpdir(), "tn-conf-"));
  await mkdir(path.join(vault, "TaskNotes"), { recursive: true });
  await writeFile(path.join(vault, "TaskNotes/water.md"), RECURRING);
  repo = new TaskRepository(vault, "TaskNotes", config, () => NOW);
  await repo.scan();
});

test("the conformance harness itself is spec 0.2.0", () => {
  expect(conformanceMetadata.spec_version).toBe("0.2.0");
  expect(conformanceMetadata.implementation).toBe("@tasknotes/model");
});

describe("server behavior matches the spec harness", () => {
  test("recurring completion: repository result equals the spec verdict", async () => {
    const spec = z
      .object({ completeInstances: z.array(z.string()) })
      .loose()
      .parse(
        run("recurrence.complete", {
          recurrence: "FREQ=DAILY",
          scheduled: "2026-07-01",
          date: "2026-07-01",
          complete_instances: [],
        }),
      );

    const ours = await repo.completeInstance("TaskNotes/water.md", {
      date: "2026-07-01",
      completed: true,
    });
    expect(ours.complete_instances).toEqual(spec.completeInstances);
  });

  test("task detection: repository visibility equals spec verdicts", async () => {
    const cases: { frontmatter: Record<string, unknown>; file: string }[] = [
      { frontmatter: { title: "T", tags: ["task"] }, file: "tagged.md" },
      { frontmatter: { title: "T", tags: ["note"] }, file: "untagged.md" },
      { frontmatter: { title: "T" }, file: "no-tags.md" },
    ];
    for (const { frontmatter, file } of cases) {
      const verdict = z.object({ value: z.boolean() }).parse(
        run("config.detect_task_file", {
          frontmatter,
          task_detection: {
            method: config.taskIdentification.method,
            tag: config.taskIdentification.tag,
          },
        }),
      ).value;

      const yaml = Object.entries(frontmatter)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join("\n");
      await writeFile(
        path.join(vault, `TaskNotes/${file}`),
        `---\n${yaml}\n---\n`,
      );
      await repo.refreshFile(`TaskNotes/${file}`);
      expect(
        `${file}:${String(repo.get(`TaskNotes/${file}`) !== undefined)}`,
      ).toBe(`${file}:${String(verdict)}`);
    }
  });

  test("completed-status semantics equal spec verdicts for every configured status", () => {
    for (const status of config.statuses) {
      const verdict = z
        .object({ value: z.boolean() })
        .parse(
          run("field.is_completed_status", { status: status.value }),
        ).value;
      expect(`${status.value}:${String(repo.isCompleted(status.value))}`).toBe(
        `${status.value}:${String(verdict)}`,
      );
    }
  });

  test("effective recurring state for a completed instance date", async () => {
    await repo.completeInstance("TaskNotes/water.md", {
      date: "2026-07-01",
      completed: true,
    });
    const task = repo.get("TaskNotes/water.md")?.task;
    const state = z.object({ status: z.string() }).parse(
      run("recurrence.effective_state", {
        task,
        date: "2026-07-01",
        completedStatus: repo.defaultCompletedStatus(),
      }),
    );
    // The spec says: on a completed instance's date the task reads as done.
    expect(state.status).toBe(repo.defaultCompletedStatus());
  });
});
