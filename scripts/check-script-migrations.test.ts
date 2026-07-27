import { describe, expect, test } from "bun:test";

import { validateManifestStructure } from "./check-script-migrations.ts";

describe("validateManifestStructure", () => {
  test("accepts a complete port and a retained shell contract", () => {
    expect(
      validateManifestStructure([
        {
          source: "scripts/a.sh",
          disposition: "port",
          reason: "Bun is available",
          replacement: "scripts/a.ts",
          owner: {
            packageJson: "scripts/package.json",
            tsconfig: "scripts/tsconfig.json",
            eslintConfig: "scripts/eslint.config.ts",
          },
          tests: ["scripts/a.test.ts"],
        },
        {
          source: "bootstrap.sh",
          disposition: "retain",
          reason: "Installs Bun",
        },
      ]),
    ).toEqual([]);
  });

  test("rejects duplicate sources and incomplete ports", () => {
    expect(
      validateManifestStructure([
        {
          source: "scripts/a.sh",
          disposition: "port",
          reason: "Bun is available",
        },
        {
          source: "scripts/a.sh",
          disposition: "delete",
          reason: "Unused",
        },
      ]),
    ).toEqual([
      "port is missing replacement: scripts/a.sh",
      "port is missing owner: scripts/a.sh",
      "port is missing tests: scripts/a.sh",
      "duplicate manifest source: scripts/a.sh",
    ]);
  });
});
