import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { z } from "zod/v4";
import {
  previewStorybook,
  resolvePreviewNodeExecutable,
} from "./preview-runtime.ts";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const inheritedEnvironment: NodeJS.ProcessEnv = Bun.env;
const fixtureRoots: string[] = [];

afterEach(async () => {
  for (const root of fixtureRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function runtimeFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "scout-preview-runtime-"));
  fixtureRoots.push(root);
  return root;
}

async function fakeMise(root: string, contents: string): Promise<void> {
  const executable = path.join(root, "mise");
  await writeFile(executable, `#!/bin/sh\n${contents}\n`);
  await chmod(executable, 0o755);
}

test("preserves the CI Node installation root through Turbo's strict E2E environment", async () => {
  const root = await runtimeFixture();
  const dryRun = Bun.spawnSync(
    [
      process.execPath,
      "x",
      "--no-install",
      "turbo",
      "run",
      "test:e2e",
      "--filter=@scout-for-lol/design-system",
      "--env-mode=strict",
      "--dry=json",
    ],
    {
      cwd: path.resolve(packageRoot, "../../../.."),
      env: {
        ...inheritedEnvironment,
        MISE_DATA_DIR: path.join(root, "mise-data"),
        PLAYWRIGHT_BROWSERS_PATH: path.join(root, "browser-cache"),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  expect(dryRun.exitCode).toBe(0);
  const rawReport: unknown = JSON.parse(
    new TextDecoder().decode(dryRun.stdout),
  );
  const report = z
    .object({
      envMode: z.literal("strict"),
      tasks: z.array(
        z.object({
          taskId: z.string(),
          environmentVariables: z.unknown(),
        }),
      ),
    })
    .parse(rawReport);
  const task = report.tasks.find(
    (entry) => entry.taskId === "@scout-for-lol/design-system#test:e2e",
  );
  const environment = z
    .object({ passthrough: z.array(z.string()) })
    .parse(task?.environmentVariables);
  const names = environment.passthrough.map((entry) => entry.split("=")[0]);
  expect(names).toContain("MISE_DATA_DIR");
  expect(names).toContain("PLAYWRIGHT_BROWSERS_PATH");
});

test("bypasses a Bun node shim and executes the installed Node runtime", async () => {
  const root = await runtimeFixture();
  await symlink(process.execPath, path.join(root, "node"));
  const environment = {
    ...inheritedEnvironment,
    PATH: `${root}:${inheritedEnvironment["PATH"] ?? ""}`,
  };
  const misleadingNode = Bun.spawnSync(
    ["node", "--print", "process.versions.bun"],
    { env: environment, stdout: "pipe", stderr: "pipe" },
  );
  expect(misleadingNode.exitCode).toBe(0);
  expect(new TextDecoder().decode(misleadingNode.stdout).trim()).toBe(
    process.versions.bun,
  );

  const executable = await resolvePreviewNodeExecutable(
    packageRoot,
    environment,
  );
  const actualNode = Bun.spawnSync(
    [executable, "--print", "process.versions.bun === undefined"],
    { env: environment, stdout: "pipe", stderr: "pipe" },
  );
  expect(actualNode.exitCode).toBe(0);
  expect(new TextDecoder().decode(actualNode.stdout).trim()).toBe("true");
});

test("fails when the configured Node installation is unavailable", async () => {
  const root = await runtimeFixture();
  await fakeMise(root, "exit 1");
  await expect(
    resolvePreviewNodeExecutable(packageRoot, {
      ...inheritedEnvironment,
      PATH: root,
    }),
  ).rejects.toThrow("requires installed Node");
});

test("the preview launches installed Node when PATH names Bun and mise cannot install tools", async () => {
  const root = await runtimeFixture();
  const executable = await resolvePreviewNodeExecutable(packageRoot);
  await symlink(process.execPath, path.join(root, "node"));
  await fakeMise(
    root,
    String.raw`test "$1" = where && test "$2" = node || exit 1
test "$PWD" = "$SCOUT_TEST_REPOSITORY_ROOT" || exit 1
printf "%s\n" "$SCOUT_TEST_NODE_ROOT"`,
  );
  const vite = path.join(root, "node_modules/vite/bin");
  await mkdir(vite, { recursive: true });
  const resultFile = path.join(root, "preview-result.json");
  await writeFile(
    path.join(vite, "vite.js"),
    `require("node:fs").writeFileSync(process.env.SCOUT_TEST_PREVIEW_RESULT,
      JSON.stringify({ isBun: typeof process.versions.bun === "string", args: process.argv.slice(2) }));`,
  );
  expect(
    await previewStorybook(
      {
        packageRoot: root,
        port: 5191,
        config: "catalog.ts",
        args: ["--debug"],
      },
      {
        ...inheritedEnvironment,
        PATH: root,
        SCOUT_TEST_NODE_ROOT: path.dirname(path.dirname(executable)),
        SCOUT_TEST_REPOSITORY_ROOT: path.resolve(packageRoot, "../../../.."),
        SCOUT_TEST_PREVIEW_RESULT: resultFile,
      },
    ),
  ).toBe(0);
  expect(await Bun.file(resultFile).json()).toEqual({
    isBun: false,
    args: [
      "preview",
      "--outDir",
      "storybook-static",
      "--host",
      "127.0.0.1",
      "--port",
      "5191",
      "--strictPort",
      "--config",
      "catalog.ts",
      "--debug",
    ],
  });
});

test("rejects Bun even if the configured installation names it node", async () => {
  const root = await runtimeFixture();
  await mkdir(path.join(root, "bin"));
  await symlink(process.execPath, path.join(root, "bin", "node"));
  await fakeMise(root, String.raw`printf "%s\n" "$SCOUT_TEST_NODE_ROOT"`);
  await expect(
    resolvePreviewNodeExecutable(packageRoot, {
      ...inheritedEnvironment,
      PATH: root,
      SCOUT_TEST_NODE_ROOT: root,
    }),
  ).rejects.toThrow("real Node runtime");
});
