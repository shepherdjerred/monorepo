import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "bun:test";
import { noReExports } from "./no-re-exports";

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

ruleTester.run("no-re-exports", noReExports, {
  valid: [
    { code: `export function myFunction() { return 42; }` },
    { code: `export type MyType = { id: string; };` },
    { code: `import { type ImportedType } from "./other"; export type MyType = ImportedType & { extra: string };` },
    { code: `import { type ImportedType } from "./other"; export type MyType = Array<ImportedType>;` },
    { code: `export interface MyInterface { id: string; }` },
    { code: `export const myConst = "value";` },
    { code: `import { something } from "./other"; const x = something();` },
  ],
  invalid: [
    { code: `export * from "./other-module";`, errors: [{ messageId: "noExportAll" }] },
    { code: `export { myFunction } from "./other-module";`, errors: [{ messageId: "noExportNamed" }] },
    { code: `import { myFunction } from "./other"; export { myFunction };`, errors: [{ messageId: "noReExportImported" }] },
    { code: `export type { MyType } from "./other-module";`, errors: [{ messageId: "noExportNamed" }] },
    { code: `import { myFunction } from "./other"; export const reexported = myFunction;`, errors: [{ messageId: "noReExportImported" }] },
    {
      code: `import { a, b } from "./other"; export const x = a; export const y = b;`,
      errors: [{ messageId: "noReExportImported" }, { messageId: "noReExportImported" }],
    },
    { code: `import { type ImportedType } from "./other"; export type MyType = ImportedType;`, errors: [{ messageId: "noReExportImported" }] },
    { code: `import { ImportedType } from "./other"; export type MyType = ImportedType;`, errors: [{ messageId: "noReExportImported" }] },
  ],
});
