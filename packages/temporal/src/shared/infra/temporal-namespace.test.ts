import { describe, expect, test } from "vitest";
import {
  parseTemporalNamespace,
  temporalNamespacesForMonitoring,
} from "./temporal-namespace.ts";

describe("Temporal namespace contracts", () => {
  test.each(["dev", "beta", "prod"])("accepts active namespace %s", (value) => {
    expect(parseTemporalNamespace(value)).toBe(value);
  });

  test.each([undefined, "", "default", "production", "scout-beta"])(
    "rejects invalid active namespace %s",
    (value) => {
      expect(() => parseTemporalNamespace(value)).toThrow();
    },
  );

  test("monitors both deployed namespaces from production", () => {
    expect(temporalNamespacesForMonitoring("prod")).toEqual(["prod", "beta"]);
  });

  test("monitors the active namespace during local development", () => {
    expect(temporalNamespacesForMonitoring("dev")).toEqual(["dev"]);
    expect(temporalNamespacesForMonitoring("beta")).toEqual(["beta"]);
  });
});
