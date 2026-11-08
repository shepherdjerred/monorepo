import assert from "node:assert/strict";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { boundedCommand } from "./bounded-command";

test.each(["test", "test:ci"])(
  "Turbo orders every Android Gradle writer in the %s verification graph",
  async (testTask) => {
    const result = await boundedCommand(
      [
        "bun",
        "x",
        "--no-install",
        "turbo",
        "run",
        "build",
        "typecheck",
        "lint",
        testTask,
        "--filter=tasknotes-android",
        "--dry=json",
      ],
      {
        cwd: resolve(import.meta.dir, "../../.."),
        logs: resolve(import.meta.dir, "../build/turbo-task-graphs"),
        timeoutMS: 20_000,
      },
    );
    const graph: unknown = JSON.parse(result.stdout.toString("utf8"));
    assert.ok(
      typeof graph === "object" &&
        graph !== null &&
        "tasks" in graph &&
        Array.isArray(graph.tasks),
    );
    const dependencies = new Map<string, string[]>();
    for (const raw of graph.tasks) {
      const task: unknown = raw;
      assert.ok(
        typeof task === "object" &&
          task !== null &&
          "taskId" in task &&
          typeof task.taskId === "string" &&
          "dependencies" in task &&
          Array.isArray(task.dependencies),
      );
      const required: string[] = [];
      for (const dependency of task.dependencies) {
        assert.ok(typeof dependency === "string");
        required.push(dependency);
      }
      dependencies.set(task.taskId, required);
    }
    function follows(task: string, prior: string): boolean {
      const pending = [task];
      const visited = new Set<string>();
      while (pending.length > 0) {
        const next = pending.pop();
        assert.ok(next !== undefined);
        if (visited.has(next)) continue;
        visited.add(next);
        const required = dependencies.get(next);
        assert.ok(required !== undefined, `Missing resolved task: ${next}`);
        if (required.includes(prior)) return true;
        pending.push(...required);
      }
      return false;
    }
    const writers = ["build", "typecheck", "lint", testTask].map(
      (task) => `tasknotes-android#${task}`,
    );
    for (const writer of writers) expect(dependencies.has(writer)).toBe(true);
    for (const [index, first] of writers.entries()) {
      for (const second of writers.slice(index + 1)) {
        expect(
          follows(first, second) || follows(second, first),
          `${first} and ${second} must not overlap`,
        ).toBe(true);
      }
    }
  },
  25_000,
);
