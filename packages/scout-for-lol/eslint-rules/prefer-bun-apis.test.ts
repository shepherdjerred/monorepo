import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "bun:test";
import { preferBunApis } from "./prefer-bun-apis";

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

ruleTester.run("prefer-bun-apis", preferBunApis, {
  valid: [
    {
      name: "allows Bun.env",
      code: `const token = Bun.env.TOKEN;`,
    },
    {
      name: "allows import.meta.dir",
      code: `const dir = import.meta.dir;`,
    },
    {
      name: "allows import.meta.path",
      code: `const path = import.meta.path;`,
    },
    {
      name: "allows ESM imports",
      code: `import { something } from "module";`,
    },
    {
      name: "allows Uint8Array",
      code: `const data = new Uint8Array([1, 2, 3]);`,
    },
  ],
  invalid: [
    {
      name: "disallows process.env",
      code: `const token = process.env.TOKEN;`,
      errors: [
        {
          messageId: "preferBunEnv",
        },
      ],
    },
    {
      name: "disallows __dirname",
      code: `const dir = __dirname;`,
      errors: [
        {
          messageId: "preferImportMetaDir",
        },
      ],
    },
    {
      name: "disallows __filename",
      code: `const file = __filename;`,
      errors: [
        {
          messageId: "preferImportMetaPath",
        },
      ],
    },
    {
      name: "disallows require()",
      code: `const module = require("module");`,
      errors: [
        {
          messageId: "preferEsmImport",
        },
      ],
    },
  ],
});
