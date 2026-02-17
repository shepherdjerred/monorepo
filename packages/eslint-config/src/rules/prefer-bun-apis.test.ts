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
    { code: `const token = Bun.env.TOKEN;` },
    { code: `const dir = import.meta.dir;` },
    { code: `const path = import.meta.path;` },
    { code: `import { something } from "module";` },
    { code: `const data = new Uint8Array([1, 2, 3]);` },
  ],
  invalid: [
    {
      code: `const token = process.env.TOKEN;`,
      errors: [{ messageId: "preferBunEnv" }],
    },
    {
      code: `const dir = __dirname;`,
      errors: [{ messageId: "preferImportMetaDir" }],
    },
    {
      code: `const file = __filename;`,
      errors: [{ messageId: "preferImportMetaPath" }],
    },
    {
      code: `const module = require("module");`,
      errors: [{ messageId: "preferEsmImport" }],
    },
  ],
});
