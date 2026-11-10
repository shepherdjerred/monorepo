import { expect, test } from "vitest";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import { checkKnip, generateCommands, knipCommand } from "./knip.ts";

test("knip gate enforces configuration hints via knip's structured flag", () => {
  expect(knipCommand).toContain("--treat-config-hints-as-errors");
  expect(knipCommand).not.toContain("--no-config-hints");
  // The gate must run the workspace-installed knip, never a network fetch.
  expect(knipCommand.slice(0, 3)).toEqual(["bunx", "--no-install", "knip"]);
});

test("knip gate materializes temporal's ha-schema so resolution is deterministic", () => {
  // Without this the gate is bistable: `#generated/ha-schema.ts` is
  // unresolved on a cold tree and a stale ignoreUnresolved entry on a
  // warm one. It must NOT nest `turbo run generate`: //#knip runs inside
  // the verify graph, which already runs generate, and nesting races the
  // per-package Prisma generate lock.
  expect(generateCommands).toEqual([
    ["bun", "packages/temporal/scripts/homelab/ensure-ha-schema.ts"],
  ]);
  expect(generateCommands.flat()).not.toContain("turbo");
});

test("checkKnip propagates knip's non-zero exit as a thrown error", async () => {
  // `--config <missing file>` makes knip itself fail fast without a scan, so
  // this asserts the wrapper's fail-fast contract (run() throws on non-zero)
  // without paying for a full repo analysis in unit tests.
  await expect(
    checkKnip(["--config", "knip.does-not-exist.json"]),
  ).rejects.toThrow(/Command failed/);
});

test("cold-checkout Knip orders provider generation even when only the root gate is selected", async () => {
  const child = Bun.spawn(
    [
      "bunx",
      "--no-install",
      "turbo",
      "run",
      "knip",
      "--filter=//",
      "--dry=json",
    ],
    {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect({ exitCode, stderr: exitCode === 0 ? "" : stderr }).toEqual({
    exitCode: 0,
    stderr: "",
  });
  const plan = z
    .object({
      tasks: z.array(
        z.object({
          taskId: z.string(),
          dependencies: z.array(z.string()),
          dependents: z.array(z.string()),
          outputs: z.array(z.string()).nullable(),
        }),
      ),
    })
    .parse(JSON.parse(stdout));
  const knip = plan.tasks.find((task) => task.taskId === "//#knip");
  const producer = plan.tasks.find(
    (task) => task.taskId === "@homelab/cdktn#generate",
  );
  expect(knip?.dependencies).toContain("@homelab/cdktn#generate");
  expect(producer?.dependents).toContain("//#knip");
  expect(producer?.outputs).toContain("generated/**");
});
