import {
  chmod,
  copyFile,
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
  previewNodeExecutablePath,
  resolvePreviewNodeExecutable,
} from "./preview-runtime.ts";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const inheritedEnvironment: NodeJS.ProcessEnv = Bun.env;
const fixtureRoots: string[] = [];

afterEach(async () => {
  for (const root of fixtureRoots.splice(0)) {
    if (
      !path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep) ||
      !path.basename(root).startsWith("scout-preview-runtime-")
    ) {
      throw new Error("Refusing to remove an unexpected runtime fixture path");
    }
    await rm(root, { recursive: true, force: true });
  }
});

async function runtimeFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "scout-preview-runtime-"));
  fixtureRoots.push(root);
  return root;
}

async function fakeMise(
  root: string,
  contents: { posix: string; windows: string },
): Promise<void> {
  const windows = process.platform === "win32";
  const executable = path.join(root, windows ? "mise.cmd" : "mise");
  await writeFile(
    executable,
    windows
      ? `@echo off\r\n${contents.windows}\r\n`
      : `#!/bin/sh\n${contents.posix}\n`,
  );
  if (!windows) await chmod(executable, 0o755);
}

async function bunNodeShim(root: string): Promise<void> {
  const executable = path.join(
    root,
    process.platform === "win32" ? "node.exe" : "node",
  );
  if (process.platform === "win32")
    await copyFile(process.execPath, executable);
  else await symlink(process.execPath, executable);
}

function fixtureEnvironment(
  root: string,
  inheritPath = false,
): NodeJS.ProcessEnv {
  const inheritedPath =
    inheritedEnvironment["PATH"] ?? inheritedEnvironment["Path"] ?? "";
  const environment = Object.fromEntries(
    Object.entries(inheritedEnvironment).filter(
      ([key]) => key.toUpperCase() !== "PATH",
    ),
  );
  return {
    ...environment,
    PATH: inheritPath ? [root, inheritedPath].join(path.delimiter) : root,
  };
}

async function installedNodeFixture(): Promise<string> {
  const searchPath =
    inheritedEnvironment["PATH"] ?? inheritedEnvironment["Path"] ?? "";
  for (const directory of searchPath.split(path.delimiter)) {
    if (directory.length === 0 || /[\\/]mise[\\/]shims[\\/]?$/i.test(directory))
      continue;
    const executable = path.join(
      directory,
      process.platform === "win32" ? "node.exe" : "node",
    );
    if (!(await Bun.file(executable).exists())) continue;
    const probe = Bun.spawnSync(
      [executable, "--print", "process.versions.bun === undefined"],
      { env: inheritedEnvironment, stdout: "pipe", stderr: "pipe" },
    );
    if (
      probe.exitCode === 0 &&
      new TextDecoder().decode(probe.stdout).trim() === "true"
    )
      return executable;
  }
  throw new Error(
    "Preview runtime tests require a real installed Node executable on PATH",
  );
}

test("uses mise's platform-specific Node executable layout", () => {
  expect(
    previewNodeExecutablePath(String.raw`C:\mise\node\24.21.0`, "win32"),
  ).toBe(String.raw`C:\mise\node\24.21.0\node.exe`);
  expect(previewNodeExecutablePath("/opt/mise/node/24.21.0", "linux")).toBe(
    "/opt/mise/node/24.21.0/bin/node",
  );
  expect(previewNodeExecutablePath("/opt/mise/node/24.21.0", "darwin")).toBe(
    "/opt/mise/node/24.21.0/bin/node",
  );
});

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
  await bunNodeShim(root);
  const node = await installedNodeFixture();
  const nodeRoot =
    process.platform === "win32"
      ? path.dirname(node)
      : path.dirname(path.dirname(node));
  await fakeMise(root, {
    posix: String.raw`printf "%s\n" "$SCOUT_TEST_NODE_ROOT"`,
    windows: "echo %SCOUT_TEST_NODE_ROOT%",
  });
  const environment = {
    ...fixtureEnvironment(root, true),
    SCOUT_TEST_NODE_ROOT: nodeRoot,
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
  await fakeMise(root, { posix: "exit 1", windows: "exit /b 1" });
  await expect(
    resolvePreviewNodeExecutable(packageRoot, {
      ...fixtureEnvironment(root),
    }),
  ).rejects.toThrow("requires installed Node");
});

test("the preview launches installed Node when PATH names Bun and mise cannot install tools", async () => {
  const root = await runtimeFixture();
  const executable = await installedNodeFixture();
  await bunNodeShim(root);
  await fakeMise(root, {
    posix: String.raw`test "$1" = where && test "$2" = node || exit 1
test "$PWD" = "$SCOUT_TEST_REPOSITORY_ROOT" || exit 1
printf "%s\n" "$SCOUT_TEST_NODE_ROOT"`,
    windows:
      'if not "%~1"=="where" exit /b 1\r\nif not "%~2"=="node" exit /b 1\r\nif /I not "%CD%"=="%SCOUT_TEST_REPOSITORY_ROOT%" exit /b 1\r\necho %SCOUT_TEST_NODE_ROOT%',
  });
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
        ...fixtureEnvironment(root),
        SCOUT_TEST_NODE_ROOT:
          process.platform === "win32"
            ? path.dirname(executable)
            : path.dirname(path.dirname(executable)),
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
  const nodeBin = process.platform === "win32" ? root : path.join(root, "bin");
  await mkdir(nodeBin, { recursive: true });
  await bunNodeShim(nodeBin);
  await fakeMise(root, {
    posix: String.raw`printf "%s\n" "$SCOUT_TEST_NODE_ROOT"`,
    windows: "echo %SCOUT_TEST_NODE_ROOT%",
  });
  await expect(
    resolvePreviewNodeExecutable(packageRoot, {
      ...fixtureEnvironment(root),
      SCOUT_TEST_NODE_ROOT: root,
    }),
  ).rejects.toThrow("real Node runtime");
});
