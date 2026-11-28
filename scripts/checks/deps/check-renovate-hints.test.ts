import { describe, expect, test } from "vitest";
import { z } from "zod";

import {
  hintViolations,
  KNOWN_DATASOURCES,
  managerCoversFile,
  type RegexManager,
  type Violation,
} from "./check-renovate-hints.ts";

const ConfigSchema = z.object({
  customManagers: z.array(
    z.union([
      z.object({
        customType: z.literal("regex"),
        description: z.string(),
        managerFilePatterns: z.array(z.string()),
        matchStrings: z.array(z.string()),
      }),
      z.looseObject({ customType: z.literal("jsonata") }),
    ]),
  ),
});

async function repositoryManagers(): Promise<RegexManager[]> {
  const config = ConfigSchema.parse(
    await Bun.file(`${import.meta.dir}/../../../renovate.json`).json(),
  );
  return config.customManagers.flatMap((manager) =>
    manager.customType === "regex" ? [manager] : [],
  );
}

// Fixtures are assembled from parts so this file never contains a real hint
// line: the hinted-pin manager reads `scripts/**/*.ts`, and Renovate would
// extract a literal hint here as a dependency of the repository.
const HINT = ["#", "renovate:"].join(" ");
function hint(fields: string): string {
  return `${HINT} ${fields}`;
}

function violationsFor(
  managers: readonly RegexManager[],
  file: string,
  lines: string[],
): Violation[] {
  return hintViolations({
    managers,
    customDatasources: [],
    file,
    source: `${lines.join("\n")}\n`,
  });
}

describe("managerCoversFile", () => {
  test("treats a slash-delimited pattern as a regular expression", () => {
    const manager = { managerFilePatterns: ["/(^|/)Dockerfile$/"] };
    expect(managerCoversFile(manager, "Dockerfile")).toBe(true);
    expect(managerCoversFile(manager, "packages/app/Dockerfile")).toBe(true);
    expect(
      managerCoversFile(manager, "packages/app/Dockerfile.dockerignore"),
    ).toBe(false);
  });

  test("treats any other pattern as a glob", () => {
    const manager = { managerFilePatterns: ["packages/*/scripts/**/*.ts"] };
    expect(managerCoversFile(manager, "packages/app/scripts/a/b.ts")).toBe(
      true,
    );
    expect(managerCoversFile(manager, "packages/app/src/b.ts")).toBe(false);
  });
});

describe("hintViolations", () => {
  test("accepts a hinted pin the repository's managers extract", async () => {
    const managers = await repositoryManagers();
    expect(
      violationsFor(managers, "packages/example/Dockerfile", [
        "FROM scratch",
        hint("datasource=github-releases depName=example/tool"),
        "ARG TOOL_VERSION=1.2.3",
      ]),
    ).toEqual([]);
  });

  test("rejects a hint in a file no manager reads", async () => {
    const managers = await repositoryManagers();
    const violations = violationsFor(managers, "packages/example/build.py", [
      hint("datasource=github-releases depName=example/tool"),
      'TOOL_VERSION = "1.2.3"',
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      file: "packages/example/build.py",
      line: 1,
    });
    expect(violations[0]?.message).toContain("no custom manager");
  });

  test("rejects a hint whose pin is not on the next line", async () => {
    const managers = await repositoryManagers();
    const violations = violationsFor(managers, "packages/example/Dockerfile", [
      hint("datasource=github-releases depName=example/tool"),
      "# A comment between the hint and the pin hides the pin.",
      "ARG TOOL_VERSION=1.2.3",
    ]);
    expect(violations.map((violation) => violation.line)).toEqual([1]);
  });

  test("rejects a datasource Renovate does not have", async () => {
    const managers = await repositoryManagers();
    const violations = violationsFor(managers, "packages/example/Dockerfile", [
      hint("datasource=dotnet-sdk depName=dotnet-sdk"),
      "ARG DOTNET_SDK_VERSION=10.0.100",
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("datasource=dotnet-sdk");
    expect(KNOWN_DATASOURCES.has("dotnet-version")).toBe(true);
  });

  test("accepts a custom datasource only when renovate.json defines it", async () => {
    const managers = await repositoryManagers();
    const input = {
      managers,
      file: "packages/example/Dockerfile",
      source: `${hint("datasource=custom.example depName=tool")}\nARG TOOL_VERSION=1.2.3\n`,
    };
    expect(hintViolations({ ...input, customDatasources: [] })).toHaveLength(1);
    expect(
      hintViolations({ ...input, customDatasources: ["example"] }),
    ).toEqual([]);
  });

  test("leaves an image hint above FROM to the native dockerfile manager", async () => {
    const managers = await repositoryManagers();
    expect(
      violationsFor(managers, "packages/example/Dockerfile", [
        hint("datasource=docker depName=caddy"),
        "FROM caddy:2.11.7-alpine AS runtime",
      ]),
    ).toEqual([]);
  });

  test("rejects a pin two managers would both update", () => {
    const expression = String.raw`${HINT} datasource=(?<datasource>\S+) depName=(?<depName>\S+)\nARG \w+=(?<currentValue>\S+)`;
    const manager = (description: string): RegexManager => ({
      customType: "regex",
      description,
      managerFilePatterns: ["packages/example/Dockerfile"],
      matchStrings: [expression],
    });
    const violations = violationsFor(
      [manager("first"), manager("second")],
      "packages/example/Dockerfile",
      [
        hint("datasource=github-releases depName=example/tool"),
        "ARG TOOL_VERSION=1.2.3",
      ],
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("duplicate updates");
  });

  test("rejects a match that repeats the pinned value", async () => {
    const managers = await repositoryManagers();
    const violations = violationsFor(managers, "packages/example/Dockerfile", [
      hint(
        "datasource=github-releases depName=example/tool extractVersion=^tool-1.2.3$",
      ),
      "ARG TOOL_VERSION=1.2.3",
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("occurs 2 times");
  });

  test("follows a branch head only with a repository and a ref", async () => {
    const managers = await repositoryManagers();
    const commit = "a".repeat(40);
    expect(
      violationsFor(managers, "packages/example/Dockerfile", [
        hint(
          "datasource=git-refs depName=apple-libtapi packageName=https://github.com/tpoechtrager/apple-libtapi ref=HEAD",
        ),
        `ARG TBD_LIBRARY_COMMIT=${commit}`,
      ]),
    ).toEqual([]);
    const violations = violationsFor(managers, "packages/example/Dockerfile", [
      hint("datasource=git-refs depName=apple-libtapi"),
      `ARG TBD_LIBRARY_COMMIT=${commit}`,
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("packageName=");
  });
});
