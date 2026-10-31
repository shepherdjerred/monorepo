import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
  checkAppKitBaseline,
  validateAppKitBaseline,
  validateAppKitConfiguration,
} from "./check-appkit-baseline.ts";

const root = resolve(import.meta.dir, "..");
const baseline: unknown = JSON.parse(
  readFileSync(resolve(root, ".swiftlint-appkit-baseline.json"), "utf8"),
);
const source = readFileSync(
  resolve(
    root,
    "Sources/TaskNotesFacetUI/Presentation/FacetWindowCloseGuard.swift",
  ),
  "utf8",
);

describe("external AppKit protocol baseline", () => {
  test("keeps the ordinary optional-collection rule enabled outside the protocol baseline", () => {
    const configuration = readFileSync(resolve(root, ".swiftlint.yml"), "utf8");
    expect(() =>
      validateAppKitConfiguration(
        configuration.replace(
          "disabled_rules:",
          "disabled_rules:\n  - discouraged_optional_collection",
        ),
      ),
    ).toThrow("strict SwiftLint");
    expect(() =>
      validateAppKitConfiguration(
        configuration.replace("  - discouraged_optional_collection", ""),
      ),
    ).toThrow("strict SwiftLint");
  });
  test("admits only the current four externally imposed signatures", () => {
    expect(() => checkAppKitBaseline(root)).not.toThrow();
    expect(() => validateAppKitBaseline([], source)).toThrow("exactly four");
    expect(() =>
      validateAppKitBaseline(
        baseline,
        source.replace("[NSWindow]?", "[NSWindow]"),
      ),
    ).toThrow();
  });

  test("rejects baseline growth, other rules and unrelated file paths", () => {
    if (!Array.isArray(baseline))
      throw new Error("Expected official SwiftLint array baseline");
    expect(() =>
      validateAppKitBaseline([...baseline, baseline[0]], source),
    ).toThrow();
    for (const [before, after] of [
      ["discouraged_optional_collection", "force_unwrapping"],
      ["FacetWindowCloseGuard.swift", "OrdinaryModel.swift"],
    ]) {
      const changed: unknown = JSON.parse(
        JSON.stringify(baseline).replaceAll(before, after),
      );
      expect(() => validateAppKitBaseline(changed, source)).toThrow(
        "approved protocol",
      );
    }
  });
});
