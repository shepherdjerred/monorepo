import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "vitest";
import { noParentImports } from "./no-parent-imports.ts";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const fixtureRoot = mkdtempSync(
  path.join(tmpdir(), "no-parent-imports-fixtures-"),
);

function createPackageFixture(
  pkgDirName: string,
  manifest: Record<string, unknown>,
): string {
  const pkgRoot = path.join(fixtureRoot, "packages", pkgDirName);
  mkdirSync(path.join(pkgRoot, "src", "automation", "files"), {
    recursive: true,
  });
  writeFileSync(
    path.join(pkgRoot, "package.json"),
    JSON.stringify(manifest, null, 2),
  );
  return pkgRoot;
}

const hashImportsPkg = createPackageFixture("media-like", {
  name: "@shepherdjerred/media-like",
  exports: {
    "./contract": "./src/shared/contract.ts",
    "./domain/*": "./src/domain/*.ts",
  },
  imports: {
    "#generated/*": "./generated/*",
    "#*": "./src/*",
  },
});

const restrictedExportsPkg = createPackageFixture("restricted-pkg", {
  name: "@shepherdjerred/restricted-pkg",
  exports: {
    ".": {
      bun: "./src/index.ts",
      import: "./dist/index.js",
    },
    "./public/*": "./src/public/*.ts",
  },
});

const unrestrictedPkg = createPackageFixture("open-pkg", {
  name: "@custom-scope/open-pkg",
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      projectService: false,
    },
  },
});

ruleTester.run("no-parent-imports", noParentImports, {
  valid: [
    { code: `import { x } from "./local-file";` },
    { code: `import { x } from "@scout-for-lol/data/model/something";` },
    { code: `import { x } from "#infrastructure/database.ts";` },
    { code: `import { x } from "react";` },
    { code: `import { x } from "@types/node";` },
    { code: `import { x } from "./utils/helper";` },
  ],
  invalid: [
    {
      // File in src/commands/, importing ../model/something resolves within package
      filename: "/projects/packages/my-app/src/commands/handler.ts",
      code: `import { x } from "../model/something";`,
      output: `import { x } from "@shepherdjerred/my-app/model/something";`,
      errors: [{ messageId: "noParentImports" }],
    },
    {
      // Import escapes the package (goes above src/) — no autofix
      filename: "/projects/packages/my-app/src/rules/test.ts",
      code: `import { y } from "../../utils";`,
      errors: [{ messageId: "noParentImports" }],
    },
    {
      // Import escapes the package (goes above src/) — no autofix
      filename: "/projects/packages/my-app/src/a/b/c.ts",
      code: `import { z } from "../../../deeply/nested/file";`,
      errors: [{ messageId: "noParentImports" }],
    },
    {
      // ./foo/../bar normalizes to ./bar within the same directory
      filename: "/projects/packages/eslint-config/src/rules/test.ts",
      code: `import { a } from "./foo/../bar";`,
      output: `import { a } from "@shepherdjerred/eslint-config/rules/bar";`,
      errors: [{ messageId: "noParentImports" }],
    },
    {
      // Package with "#*": "./src/*" imports rewrites to "#..." alias even when exports is restricted
      filename: path.join(
        hashImportsPkg,
        "src",
        "automation",
        "files",
        "guards.ts",
      ),
      code: `import type { Database } from "../../infrastructure/database.ts";`,
      output: `import type { Database } from "#infrastructure/database.ts";`,
      errors: [{ messageId: "noParentImports" }],
    },
    {
      // More specific "#generated/*" pattern beats "#*" and resolves package-level generated dir
      filename: path.join(hashImportsPkg, "src", "automation", "runner.ts"),
      code: `import { client } from "../../generated/client.ts";`,
      output: `import { client } from "#generated/client.ts";`,
      errors: [{ messageId: "noParentImports" }],
    },
    {
      // Exports-restricted package without "#" imports declines unsafe autofix for unexported subpath
      filename: path.join(
        restrictedExportsPkg,
        "src",
        "automation",
        "files",
        "guards.ts",
      ),
      code: `import { internal } from "../../internal/secret.ts";`,
      output: null,
      errors: [{ messageId: "noParentImports" }],
    },
    {
      // Exports-restricted package rewrites when target matches an exposed "./public/*" export
      filename: path.join(
        restrictedExportsPkg,
        "src",
        "automation",
        "files",
        "guards.ts",
      ),
      code: `import { api } from "../../public/client.ts";`,
      output: `import { api } from "@shepherdjerred/restricted-pkg/public/client";`,
      errors: [{ messageId: "noParentImports" }],
    },
    {
      // Exports-restricted package rewrites root index import to bare package name and handles extensionless exports
      filename: path.join(
        restrictedExportsPkg,
        "src",
        "automation",
        "runner.ts",
      ),
      code: `import { rootApi } from "../index";`,
      output: `import { rootApi } from "@shepherdjerred/restricted-pkg";`,
      errors: [{ messageId: "noParentImports" }],
    },
    {
      // Unrestricted package (no exports field) uses package.json#name for self-import rewrite
      filename: path.join(unrestrictedPkg, "src", "commands", "handler.ts"),
      code: `import { x } from "../model/something.ts";`,
      output: `import { x } from "@custom-scope/open-pkg/model/something.ts";`,
      errors: [{ messageId: "noParentImports" }],
    },
  ],
});
