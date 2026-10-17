import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { z } from "zod";

test("the browser CI graph generates Prisma before starting its isolated database", async () => {
  const child = Bun.spawn(
    [
      "bun",
      "x",
      "--no-install",
      "turbo",
      "run",
      "test:e2e",
      "--filter=@shepherdjerred/delivery",
      "--dry=json",
    ],
    {
      cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(exitCode, stderr).toBe(0);
  const graph = z
    .object({
      tasks: z.array(
        z.object({ taskId: z.string(), dependencies: z.array(z.string()) }),
      ),
    })
    .parse(JSON.parse(stdout));
  const browser = graph.tasks.find(
    (task) => task.taskId === "@shepherdjerred/delivery#test:e2e",
  );
  expect(browser?.dependencies).toContain("@shepherdjerred/delivery#generate");
  expect(
    graph.tasks.some(
      (task) => task.taskId === "@shepherdjerred/delivery#generate",
    ),
  ).toBe(true);
});
