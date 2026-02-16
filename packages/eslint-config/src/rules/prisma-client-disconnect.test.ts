import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "bun:test";
import { prismaClientDisconnect } from "./prisma-client-disconnect";

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

ruleTester.run("prisma-client-disconnect", prismaClientDisconnect, {
  valid: [
    {
      code: `
        import { afterAll } from "bun:test";
        const prisma = new PrismaClient();
        afterAll(async () => {
          await prisma.$disconnect();
        });
      `,
      filename: "/test/integration.integration.test.ts",
    },
    {
      code: `
        const prisma = new PrismaClient();
      `,
      filename: "/test/unit.test.ts",
    },
    {
      code: `
        import { test } from "bun:test";
        test("something", () => {});
      `,
      filename: "/test/integration.integration.test.ts",
    },
  ],
  invalid: [
    {
      code: `
        import { test } from "bun:test";
        const prisma = new PrismaClient();
        test("something", () => {});
      `,
      output: `
        import {afterAll,  test } from "bun:test";
        const prisma = new PrismaClient();
afterAll(async () => {
  await prisma.$disconnect();
});

        test("something", () => {});
      `,
      filename: "/test/integration.integration.test.ts",
      errors: [{ messageId: "missingDisconnect" }],
    },
    {
      code: `
        import { test } from "bun:test";
        const prisma1 = new PrismaClient();
        const prisma2 = new PrismaClient();
      `,
      output: `
        import {afterAll,  test } from "bun:test";
        const prisma1 = new PrismaClient();
afterAll(async () => {
  await prisma1.$disconnect();
  await prisma2.$disconnect();
});

        const prisma2 = new PrismaClient();
      `,
      filename: "/test/integration.integration.test.ts",
      errors: [{ messageId: "missingDisconnect" }, { messageId: "missingDisconnect" }],
    },
  ],
});
