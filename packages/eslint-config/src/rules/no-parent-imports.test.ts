import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "bun:test";
import { noParentImports } from "./no-parent-imports.ts";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

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
  ],
});
