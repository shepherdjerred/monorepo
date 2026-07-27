import { describe, expect, test } from "bun:test";

import { findEnvironmentVariableViolations } from "./check-env-var-names.ts";

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
});
