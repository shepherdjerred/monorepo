import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertStateRootOutsideControllerRepository,
  resolveControllerSource,
} from "@shepherdjerred/pr-fleet-controller/src/controller-metadata.ts";
import type { CommandRequest } from "@shepherdjerred/pr-fleet-controller/src/ports.ts";
import { runCommand } from "@shepherdjerred/pr-fleet-controller/src/process-runner.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function git(directory: string, args: readonly string[]): Promise<void> {
  const subprocess = Bun.spawn(["git", ...args], {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr.trim());
  }
}

test("records clean and dirty identities for the exact controller source tree", async () => {
  const repository = await mkdtemp(path.join(tmpdir(), "controller-source-"));
  temporaryDirectories.push(repository);
  const controllerDirectory = path.join(repository, "packages", "controller");
  await git(repository, ["init", "--quiet"]);
  await mkdir(controllerDirectory, { recursive: true });
  await writeFile(
    path.join(controllerDirectory, "controller.ts"),
    "export {}\n",
  );
  await git(repository, ["add", "packages/controller/controller.ts"]);
  await git(repository, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--quiet",
    "-m",
    "initial",
  ]);

  const requests: CommandRequest[] = [];
  const clean = await resolveControllerSource({
    controllerDirectory,
    run: async (request) => {
      requests.push(request);
      return runCommand(request);
    },
  });
  expect(clean.commit).toMatch(/^[0-9a-f]{40}$/);
  expect(clean.dirty).toBe(false);
  expect(clean.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  expect(requests).toHaveLength(5);
  expect(requests.every((request) => request.sensitiveOutput === true)).toBe(
    true,
  );

  await writeFile(
    path.join(controllerDirectory, "controller.ts"),
    "export const x = 1\n",
  );
  const trackedChange = await resolveControllerSource({ controllerDirectory });
  expect(trackedChange.commit).toBe(clean.commit);
  expect(trackedChange.dirty).toBe(true);
  expect(trackedChange.fingerprint).not.toBe(clean.fingerprint);

  await writeFile(
    path.join(controllerDirectory, "untracked.ts"),
    "export const y = 2\n",
  );
  const untrackedChange = await resolveControllerSource({
    controllerDirectory,
  });
  expect(untrackedChange.dirty).toBe(true);
  expect(untrackedChange.fingerprint).not.toBe(trackedChange.fingerprint);

  await writeFile(
    path.join(repository, "workspace-input.ts"),
    "export const workspaceValue = 1\n",
  );
  const workspaceInput = await resolveControllerSource({ controllerDirectory });
  expect(workspaceInput.fingerprint).not.toBe(untrackedChange.fingerprint);
  await writeFile(
    path.join(repository, "workspace-input.ts"),
    "export const workspaceValue = 2\n",
  );
  const changedWorkspaceInput = await resolveControllerSource({
    controllerDirectory,
  });
  expect(changedWorkspaceInput.fingerprint).not.toBe(
    workspaceInput.fingerprint,
  );

  const externalDirectory = await mkdtemp(
    path.join(tmpdir(), "controller-external-source-"),
  );
  temporaryDirectories.push(externalDirectory);
  const externalSource = path.join(externalDirectory, "external.ts");
  await writeFile(externalSource, "export const external = 1\n");
  await symlink(externalSource, path.join(repository, "untracked-link.ts"));
  await expect(
    resolveControllerSource({ controllerDirectory }),
  ).rejects.toThrow(
    "Unsupported untracked controller source symlink: untracked-link.ts",
  );

  const inRepositoryState = path.join(repository, "run-state");
  await mkdir(inRepositoryState);
  await expect(
    resolveControllerSource({
      controllerDirectory,
      stateRoot: inRepositoryState,
    }),
  ).rejects.toThrow(
    "Run-bundle state directory must be outside the controller repository",
  );
});

test("rejects an uncreated in-repository state root before writing it", async () => {
  const repository = await mkdtemp(path.join(tmpdir(), "controller-state-"));
  temporaryDirectories.push(repository);
  const controllerDirectory = path.join(repository, "packages", "controller");
  await git(repository, ["init", "--quiet"]);
  await mkdir(controllerDirectory, { recursive: true });
  const stateRoot = path.join(repository, "uncreated", "state");

  await expect(
    assertStateRootOutsideControllerRepository(stateRoot, controllerDirectory),
  ).rejects.toThrow(
    "Run-bundle state directory must be outside the controller repository",
  );
  await expect(stat(stateRoot)).rejects.toThrow();
});
