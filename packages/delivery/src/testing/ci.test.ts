import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { z } from "zod";

test("the browser CI graph generates Prisma and retains the image's browser directory", async () => {
  const result =
    await Bun.$`${process.execPath} x --no-install turbo run test:e2e --filter=@shepherdjerred/delivery --dry=json`
      .cwd(fileURLToPath(new URL("../../../../", import.meta.url)))
      .env({
        ...Object.fromEntries(
          Object.entries(Bun.env).filter(
            (entry) => typeof entry[1] === "string",
          ),
        ),
        PLAYWRIGHT_BROWSERS_PATH: "/fixture/baked-browsers",
      })
      .nothrow()
      .quiet();
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  const graph = z
    .object({
      tasks: z.array(
        z.object({
          taskId: z.string(),
          dependencies: z.array(z.string()),
          resolvedTaskDefinition: z.object({
            passThroughEnv: z.array(z.string()).nullable(),
          }),
          environmentVariables: z.object({
            passthrough: z.array(z.string()).nullable(),
          }),
        }),
      ),
    })
    .parse(JSON.parse(result.stdout.toString()));
  const browser = graph.tasks.find(
    (task) => task.taskId === "@shepherdjerred/delivery#test:e2e",
  );
  expect(browser?.dependencies).toContain("@shepherdjerred/delivery#generate");
  expect(browser?.resolvedTaskDefinition.passThroughEnv).toContain(
    "PLAYWRIGHT_BROWSERS_PATH",
  );
  expect(
    browser?.environmentVariables.passthrough?.some((entry) =>
      entry.startsWith("PLAYWRIGHT_BROWSERS_PATH="),
    ),
  ).toBe(true);
  expect(
    graph.tasks.some(
      (task) => task.taskId === "@shepherdjerred/delivery#generate",
    ),
  ).toBe(true);
});
