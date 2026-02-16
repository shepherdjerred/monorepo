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
    { code: `import { x } from "./local-file";` },
    { code: `import { x } from "@scout-for-lol/data/model/something";` },
    { code: `import { x } from "react";` },
    { code: `import { x } from "@types/node";` },
    { code: `import { x } from "./utils/helper";` },
  ],
  invalid: [
    { code: `import { x } from "../model/something";`, errors: [{ messageId: "noParentImports" }] },
    { code: `import { y } from "../../utils";`, errors: [{ messageId: "noParentImports" }] },
    { code: `import { z } from "../../../deeply/nested/file";`, errors: [{ messageId: "noParentImports" }] },
    { code: `import { a } from "./foo/../bar";`, errors: [{ messageId: "noParentImports" }] },
  ],
});
