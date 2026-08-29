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
        activeNamespace: "prod",
        legacyNamespace: "default",
      }),
    ).toEqual(["prod", "default"]);
  });

  test("never creates the retired default queue in the active namespace", () => {
    expect(
      workerNamespaces({
        queueRole: "legacy",
        activeNamespace: "prod",
        legacyNamespace: "default",
      }),
    ).toEqual(["default"]);
    expect(
      workerNamespaces({
        queueRole: "legacy",
        activeNamespace: "prod",
        legacyNamespace: undefined,
      }),
    ).toEqual([]);
  });

  test("uses only the active namespace after the drain", () => {
    expect(
      workerNamespaces({
        queueRole: "reports",
        activeNamespace: "beta",
        legacyNamespace: undefined,
      }),
    ).toEqual(["beta"]);
  });

  test("keeps the existing central Scout queue available to beta-owned schedules", () => {
    expect(
      workerNamespaces({
        queueRole: "scout",
        activeNamespace: "prod",
        legacyNamespace: "default",
      }),
    ).toEqual(["prod", "beta", "default"]);
  });
});
