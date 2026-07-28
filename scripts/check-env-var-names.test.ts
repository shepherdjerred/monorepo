import { describe, expect, test } from "bun:test";

import { findEnvironmentVariableViolations } from "./environment-variable-rules.ts";
import { parseCoverageSummaries } from "./migration-core.ts";

describe("findEnvironmentVariableViolations", () => {
  test("reports a simple banned name with its canonical replacement", () => {
    expect(
      findEnvironmentVariableViolations(
        "example.ts",
        "const GRAFANA_TOKEN = 1",
      ),
    ).toEqual([
      {
        path: "example.ts",
        line: 1,
        pattern: "GRAFANA_TOKEN",
        replacement: "GRAFANA_API_KEY",
        text: "const GRAFANA_TOKEN = 1",
      },
    ]);
  });

  test("matches banned names case-insensitively", () => {
    expect(
      findEnvironmentVariableViolations("example.py", "riot_api_token = 'x'"),
    ).toHaveLength(1);
  });

  test("permits the scoped Tofu GitHub token", () => {
    expect(
      findEnvironmentVariableViolations(
        "example.ts",
        "const TOFU_GITHUB_TOKEN = value",
      ),
    ).toEqual([]);
  });

  test("reports the generic GitHub token", () => {
    expect(
      findEnvironmentVariableViolations(
        "example.ts",
        "const GITHUB_TOKEN = value",
      ),
    ).toEqual([
      {
        path: "example.ts",
        line: 1,
        pattern: "GITHUB_TOKEN",
        replacement: "GH_TOKEN",
        text: "const GITHUB_TOKEN = value",
      },
    ]);
  });
});

test("parses Bun coverage summaries for the strict gate", () => {
  expect(
    parseCoverageSummaries("All files |  95.50 |  91.25 |\nnot a coverage row"),
  ).toEqual([{ functions: 95.5, lines: 91.25 }]);
  expect(parseCoverageSummaries("no summary")).toEqual([]);
});
