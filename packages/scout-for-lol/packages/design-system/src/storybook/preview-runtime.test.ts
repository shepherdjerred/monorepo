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
import { resolvePreviewNodeExecutable } from "./preview-runtime.ts";

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
