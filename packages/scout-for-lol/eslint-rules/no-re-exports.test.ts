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
    {
      name: "allows exporting locally declared function",
      code: `export function myFunction() { return 42; }`,
    },
    {
      name: "allows exporting locally declared type",
      code: `export type MyType = { id: string; };`,
    },
    {
      name: "allows exporting type alias that transforms imported type",
      code: `import { type ImportedType } from "./other"; export type MyType = ImportedType & { extra: string };`,
    },
    {
      name: "allows exporting type alias that wraps imported type",
      code: `import { type ImportedType } from "./other"; export type MyType = Array<ImportedType>;`,
    },
    {
      name: "allows exporting locally declared interface",
      code: `export interface MyInterface { id: string; }`,
    },
    {
      name: "allows exporting locally declared const",
      code: `export const myConst = "value";`,
    },
    {
      name: "allows importing and using without re-exporting",
      code: `import { something } from "./other"; const x = something();`,
    },
  ],
  invalid: [
    {
      name: "disallows export * from",
      code: `export * from "./other-module";`,
      errors: [
        {
          messageId: "noExportAll",
        },
      ],
    },
    {
      name: "disallows export { ... } from",
      code: `export { myFunction } from "./other-module";`,
      errors: [
        {
          messageId: "noExportNamed",
        },
      ],
    },
    {
      name: "disallows re-exporting imported identifiers",
      code: `import { myFunction } from "./other"; export { myFunction };`,
      errors: [
        {
          messageId: "noReExportImported",
        },
      ],
    },
    {
      name: "disallows export type re-exports",
      code: `export type { MyType } from "./other-module";`,
      errors: [
        {
          messageId: "noExportNamed",
        },
      ],
    },
    {
      name: "disallows exporting const assigned to imported value",
      code: `import { myFunction } from "./other"; export const reexported = myFunction;`,
      errors: [
        {
          messageId: "noReExportImported",
        },
      ],
    },
    {
      name: "disallows multiple const exports assigned to imported values",
      code: `import { a, b } from "./other"; export const x = a; export const y = b;`,
      errors: [
        {
          messageId: "noReExportImported",
        },
        {
          messageId: "noReExportImported",
        },
      ],
    },
    {
      name: "disallows type alias that just renames an imported type",
      code: `import { type ImportedType } from "./other"; export type MyType = ImportedType;`,
      errors: [
        {
          messageId: "noReExportImported",
        },
      ],
    },
    {
      name: "disallows type alias renaming imported type (non-type import)",
      code: `import { ImportedType } from "./other"; export type MyType = ImportedType;`,
      errors: [
        {
          messageId: "noReExportImported",
        },
      ],
    },
  ],
});
