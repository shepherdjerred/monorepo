import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

const sourcePath =
  "Sources/TaskNotesFacetUI/Presentation/FacetWindowCloseGuard.swift";
const declarations = [
  "func customWindowsToEnterFullScreen(for window: NSWindow) -> [NSWindow]? {",
  "func customWindowsToEnterFullScreen(for window: NSWindow, on screen: NSScreen)",
  "func customWindowsToExitFullScreen(for window: NSWindow) -> [NSWindow]? {",
  "func previewRepresentableActivityItems(for window: NSWindow)",
];

/** The baseline admits external protocol syntax, never ordinary optional collections. */
export function validateAppKitBaseline(
  baseline: unknown,
  source: string,
): void {
  if (!Array.isArray(baseline) || baseline.length !== declarations.length) {
    throw new Error(
      "AppKit baseline must contain exactly four protocol declarations",
    );
  }
  const lines = source.split("\n");
  const expected = declarations.map((declaration) => {
    const declarationIndex = lines.findIndex(
      (line) => line.trim() === declaration,
    );
    if (declarationIndex === -1)
      throw new Error(`Missing AppKit declaration: ${declaration}`);
    const lineIndex = declaration.includes("->")
      ? declarationIndex
      : declarationIndex + 1;
    const text = lines[lineIndex];
    if (text === undefined || !text.includes("]?"))
      throw new Error("AppKit return type changed");
    return {
      text,
      violation: {
        reason: "Prefer empty collection over optional collection",
        ruleName: "Discouraged Optional Collection",
        ruleIdentifier: "discouraged_optional_collection",
        ruleDescription: "Prefer empty collection over optional collection",
        severity: "error",
        location: {
          line: lineIndex + 1,
          file: sourcePath,
          character: text.indexOf("[") + 1,
        },
      },
    };
  });
  if (!isDeepStrictEqual(baseline, expected)) {
    throw new Error(
      "AppKit baseline differs from the four approved protocol signatures",
    );
  }
}

export function validateAppKitConfiguration(configuration: string): void {
  if (!/^baseline: \.swiftlint-appkit-baseline\.json$/m.test(configuration)) {
    throw new Error("SwiftLint must use only the approved AppKit baseline");
  }
  const disabled =
    configuration
      .split("disabled_rules:")[1]
      ?.split(/^[A-Za-z_][A-Za-z0-9_]*:/m)[0] ?? "";
  if (
    /^\s*- discouraged_optional_collection\s*$/m.test(disabled) ||
    !/^\s*- discouraged_optional_collection\s*$/m.test(
      configuration.split("opt_in_rules:")[1] ?? "",
    )
  ) {
    throw new Error(
      "Ordinary optional collections must retain their strict SwiftLint rule",
    );
  }
}

export function checkAppKitBaseline(root: string): void {
  validateAppKitConfiguration(
    readFileSync(resolve(root, ".swiftlint.yml"), "utf8"),
  );
  validateAppKitBaseline(
    JSON.parse(
      readFileSync(resolve(root, ".swiftlint-appkit-baseline.json"), "utf8"),
    ),
    readFileSync(resolve(root, sourcePath), "utf8"),
  );
}

if (import.meta.main) checkAppKitBaseline(resolve(import.meta.dir, ".."));
