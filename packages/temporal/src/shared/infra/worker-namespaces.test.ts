import { describe, expect, test } from "vitest";
import {
  assertCentralWorkerNamespace,
  workerNamespaces,
} from "./worker-namespaces.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

describe("workerNamespaces", () => {
  test("binds local all-in-one workers to dev and deployed roles to prod", () => {
    expect(() => assertCentralWorkerNamespace("all", "dev")).not.toThrow();
    expect(() => assertCentralWorkerNamespace("reports", "prod")).not.toThrow();
    expect(() => assertCentralWorkerNamespace("all", "prod")).toThrow(
      /requires namespace dev/,
    );
    expect(() => assertCentralWorkerNamespace("reports", "beta")).toThrow(
      /requires namespace prod/,
    );
  });

  test("polls the active namespace for owned queues", () => {
    expect(
      workerNamespaces({
        queueRole: "reports",
        taskQueue: "reports",
        activeNamespace: "prod",
      }),
    ).toEqual(["prod"]);
  });

  test("keeps the existing central Scout queue available to beta-owned schedules", () => {
    expect(
      workerNamespaces({
        queueRole: "scout",
        taskQueue: "scout",
        activeNamespace: "prod",
      }),
    ).toEqual(["prod", "beta"]);
  });

  test("keeps the central Workflow queue available to beta-owned schedules", () => {
    expect(
      workerNamespaces({
        queueRole: "workflows",
        taskQueue: "monorepo-workflows",
        activeNamespace: "prod",
      }),
    ).toEqual(["prod", "beta"]);
  });

  test("does not add beta pollers for activity queues", () => {
    expect(
      workerNamespaces({
        queueRole: "workflows",
        taskQueue: TASK_QUEUES.HOME,
        activeNamespace: "prod",
      }),
    ).toEqual(["prod"]);
  });
});
