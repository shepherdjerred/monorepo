import { describe, expect, test } from "vitest";
import {
  assertCentralWorkerNamespace,
  workerNamespaces,
} from "./worker-namespaces.ts";

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

  test("polls active and legacy namespaces for owned queues during drain", () => {
    expect(
      workerNamespaces({
        queueRole: "reports",
        taskQueue: "reports",
        activeNamespace: "prod",
        legacyNamespace: "default",
      }),
    ).toEqual(["prod", "default"]);
  });

  test("keeps the compatibility queue available in active and legacy namespaces", () => {
    expect(
      workerNamespaces({
        queueRole: "legacy",
        taskQueue: "default",
        activeNamespace: "prod",
        legacyNamespace: "default",
      }),
    ).toEqual(["prod", "default"]);
    expect(
      workerNamespaces({
        queueRole: "legacy",
        taskQueue: "default",
        activeNamespace: "prod",
        legacyNamespace: undefined,
      }),
    ).toEqual(["prod"]);
  });

  test("uses only the active namespace after the drain", () => {
    expect(
      workerNamespaces({
        queueRole: "reports",
        taskQueue: "reports",
        activeNamespace: "beta",
        legacyNamespace: undefined,
      }),
    ).toEqual(["beta"]);
  });

  test("keeps the existing central Scout queue available to beta-owned schedules", () => {
    expect(
      workerNamespaces({
        queueRole: "scout",
        taskQueue: "scout",
        activeNamespace: "prod",
        legacyNamespace: "default",
      }),
    ).toEqual(["prod", "beta", "default"]);
  });

  test("keeps the central Workflow queue available to beta-owned schedules", () => {
    expect(
      workerNamespaces({
        queueRole: "workflows",
        taskQueue: "monorepo-workflows",
        activeNamespace: "prod",
        legacyNamespace: "default",
      }),
    ).toEqual(["prod", "beta", "default"]);
  });

  test("does not add beta pollers for legacy workflow queues", () => {
    expect(
      workerNamespaces({
        queueRole: "workflows",
        taskQueue: "default",
        activeNamespace: "prod",
        legacyNamespace: "default",
      }),
    ).toEqual(["prod", "default"]);
  });
});
