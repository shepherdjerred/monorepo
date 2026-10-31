import { describe, expect, it } from "vitest";
import { managedFlagViolations } from "./check-managed-flags.ts";

const gate = { flagSource: "the-storm-example", keyFile: "Example.java" };
const java = `
  private static final String NAMESPACE_KEY = "the-storm";
  private static final String FLAG_KEY = "the-storm-example-enabled";
`;
const flag = {
  source: "the-storm-example",
  key: "the-storm-example-enabled",
  namespace: "the-storm",
  type: "boolean",
  default: false,
};

describe("managedFlagViolations", () => {
  it("accepts matching identifiers", () => {
    expect(
      managedFlagViolations({ flags: [flag] }, () => java, [gate]),
    ).toEqual([]);
  });

  it("rejects a differing key, namespace or default", () => {
    for (const changed of [
      { ...flag, key: "other" },
      { ...flag, namespace: "other" },
      { ...flag, default: true },
    ]) {
      expect(
        managedFlagViolations({ flags: [changed] }, () => java, [gate]),
      ).toEqual([
        "Flipt the-storm-example identifiers differ from managed inventory",
      ]);
    }
  });

  it("requires exactly one inventory flag", () => {
    expect(managedFlagViolations({ flags: [] }, () => java, [gate])).toEqual([
      "expected exactly one managed flag for the-storm-example",
    ]);
  });

  it("fails loudly when the Java constant is missing", () => {
    expect(() =>
      managedFlagViolations({ flags: [flag] }, () => "", [gate]),
    ).toThrow("missing Flipt client constant FLAG_KEY in Example.java");
  });
});
