import { describe, expect, test } from "vitest";
import {
  parseLegacyTemporalNamespace,
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

  test("allows default only for the legacy drain", () => {
    expect(parseLegacyTemporalNamespace(undefined)).toBeUndefined();
    expect(parseLegacyTemporalNamespace("")).toBeUndefined();
    expect(parseLegacyTemporalNamespace("default")).toBe("default");
    expect(() => parseLegacyTemporalNamespace("prod")).toThrow();
  });

  test("includes default monitoring only during the drain", () => {
    expect(temporalNamespacesForMonitoring("prod", undefined)).toEqual([
      "prod",
      "beta",
    ]);
    expect(temporalNamespacesForMonitoring("prod", "default")).toEqual([
      "prod",
      "beta",
      "default",
    ]);
  });

  test("monitors the active namespace during local development", () => {
    expect(temporalNamespacesForMonitoring("dev", undefined)).toEqual(["dev"]);
    expect(temporalNamespacesForMonitoring("beta", "default")).toEqual([
      "beta",
      "default",
    ]);
  });
});
