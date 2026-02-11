import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "bun:test";
import { noParentImports } from "./no-parent-imports";

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
    {
      name: "allows same-directory imports",
      code: `import { x } from "./local-file";`,
    },
    {
      name: "allows package imports",
      code: `import { x } from "@shepherdjerred/scout-data/model/something";`,
    },
    {
      name: "allows node_modules imports",
      code: `import { x } from "react";`,
    },
    {
      name: "allows scoped package imports",
      code: `import { x } from "@types/node";`,
    },
    {
      name: "allows same-directory with subdirectory",
      code: `import { x } from "./utils/helper";`,
    },
  ],
  invalid: [
    {
      name: "disallows single parent directory import",
      code: `import { x } from "../model/something";`,
      errors: [
        {
          messageId: "noParentImports",
        },
      ],
    },
    {
      name: "disallows multiple parent directory imports",
      code: `import { y } from "../../utils";`,
      errors: [
        {
          messageId: "noParentImports",
        },
      ],
    },
    {
      name: "disallows deeply nested parent imports",
      code: `import { z } from "../../../deeply/nested/file";`,
      errors: [
        {
          messageId: "noParentImports",
        },
      ],
    },
    {
      name: "detects parent imports in middle of path",
      code: `import { a } from "./foo/../bar";`,
      errors: [
        {
          messageId: "noParentImports",
        },
      ],
    },
  ],
});
