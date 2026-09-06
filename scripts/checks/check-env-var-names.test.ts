import { describe, expect, test } from "vitest";

import { findEnvironmentVariableViolations } from "./environment-variable-rules.ts";
import {
  isSearchableEnvironmentVariablePath,
  parseCoverageSummaries,
} from "../misc/migration-core.ts";

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

  test("permits a vendor CLI's own spelling at the gcx boundary", () => {
    expect(
      findEnvironmentVariableViolations(
        "packages/temporal/src/activities/gcx-context.ts",
        'const GCX_TOKEN_ENV = "GRAFANA_TOKEN";',
      ),
    ).toEqual([]);
  });

  test("keeps the vendor exemption scoped to that boundary", () => {
    expect(
      findEnvironmentVariableViolations(
        "packages/temporal/src/activities/other.ts",
        'const GCX_TOKEN_ENV = "GRAFANA_TOKEN";',
      ),
    ).toHaveLength(1);
  });

  // The exemption waives two specific vendor spellings, not the whole scan:
  // an unrelated non-canonical name must not ride in behind the boundary.
  test("still reports unrelated banned names inside an exempt file", () => {
    expect(
      findEnvironmentVariableViolations(
        "packages/temporal/src/activities/gcx-context.ts",
        "const account = CF_ACCOUNT_ID;",
      ),
    ).toEqual([
      {
        path: "packages/temporal/src/activities/gcx-context.ts",
        line: 1,
        pattern: "CF_ACCOUNT_ID",
        replacement: "CLOUDFLARE_ACCOUNT_ID",
        text: "const account = CF_ACCOUNT_ID;",
      },
    ]);
  });

  // Exact-file matching, so a neighbour whose path merely contains the exempt
  // name is not silently exempted too.
  test("does not exempt a file that only shares the boundary's path prefix", () => {
    expect(
      findEnvironmentVariableViolations(
        "packages/temporal/src/activities/gcx-context-helpers.ts",
        'const token = "GRAFANA_TOKEN";',
      ),
    ).toHaveLength(1);
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

test("environment-variable checks scope local work to relevant changed files", () => {
  expect(isSearchableEnvironmentVariablePath("packages/app/src/index.ts")).toBe(
    true,
  );
  expect(
    isSearchableEnvironmentVariablePath("packages/app/generated/client.ts"),
  ).toBe(false);
  expect(isSearchableEnvironmentVariablePath("packages/app/image.png")).toBe(
    false,
  );
});

test("parses Vitest coverage summaries for the strict gate", () => {
  expect(
    parseCoverageSummaries(
      "Functions    : 95.50% ( 191/200 )\nLines        : 91.25% ( 365/400 )\nnot a coverage summary",
    ),
  ).toEqual([{ functions: 95.5, lines: 91.25 }]);
  expect(
    parseCoverageSummaries(
      "All files          |   92.89 |    89.02 |   98.41 |   94.51 |",
    ),
  ).toEqual([{ functions: 98.41, lines: 94.51 }]);
  expect(
    parseCoverageSummaries(
      "\u{1B}[32;1mFunctions    : 100% ( 1/1 )\u{1B}[0m\n\u{1B}[32;1mLines        : 100% ( 1/1 )\u{1B}[0m",
    ),
  ).toEqual([{ functions: 100, lines: 100 }]);
  expect(parseCoverageSummaries("no summary")).toEqual([]);
});
