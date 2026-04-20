import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { formatSummary, formatFailureDetails } from "../ci-format";

import type { CheckResult } from "../ci-format";

describe("formatSummary", () => {
  it("formats all-passing results", () => {
    const results: CheckResult[] = [
      { label: "pkg-a: lint", status: "PASS" },
      { label: "pkg-a: test", status: "PASS" },
      { label: "pkg-b: lint", status: "PASS" },
    ];
    const summary = formatSummary(results);
    assert.strictEqual(
      summary,
      "PASS  pkg-a: lint\nPASS  pkg-a: test\nPASS  pkg-b: lint",
    );
  });

  it("formats mixed pass/fail results", () => {
    const results: CheckResult[] = [
      { label: "pkg-a: lint", status: "PASS" },
      { label: "pkg-a: test", status: "FAIL", error: "test failed" },
      { label: "pkg-b: lint", status: "PASS" },
    ];
    const summary = formatSummary(results);
    assert.strictEqual(
      summary,
      "PASS  pkg-a: lint\nFAIL  pkg-a: test\nPASS  pkg-b: lint",
    );
  });
});

describe("formatFailureDetails", () => {
  it("formats a single failure with error message", () => {
    const failures: CheckResult[] = [
      { label: "pkg-a: test", status: "FAIL", error: "assertion failed" },
    ];
    const details = formatFailureDetails(failures);
    assert.strictEqual(details, "--- pkg-a: test ---\nassertion failed");
  });

  it("formats multiple failures separated by blank lines", () => {
    const failures: CheckResult[] = [
      { label: "pkg-a: test", status: "FAIL", error: "error 1" },
      { label: "pkg-b: lint", status: "FAIL", error: "error 2" },
    ];
    const details = formatFailureDetails(failures);
    assert.strictEqual(
      details,
      "--- pkg-a: test ---\nerror 1\n\n--- pkg-b: lint ---\nerror 2",
    );
  });

  it("handles undefined error messages", () => {
    const failures: CheckResult[] = [{ label: "pkg-a: test", status: "FAIL" }];
    const details = formatFailureDetails(failures);
    assert.strictEqual(details, "--- pkg-a: test ---\nundefined");
  });
});
