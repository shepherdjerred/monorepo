import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveControllerSource } from "@shepherdjerred/pr-fleet-controller/src/controller-metadata.ts";

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

  const clean = await resolveControllerSource(controllerDirectory);
  expect(clean.commit).toMatch(/^[0-9a-f]{40}$/);
  expect(clean.dirty).toBe(false);
  expect(clean.fingerprint).toMatch(/^[0-9a-f]{64}$/);

  await writeFile(
    path.join(controllerDirectory, "controller.ts"),
    "export const x = 1\n",
  );
  const trackedChange = await resolveControllerSource(controllerDirectory);
  expect(trackedChange.commit).toBe(clean.commit);
  expect(trackedChange.dirty).toBe(true);
  expect(trackedChange.fingerprint).not.toBe(clean.fingerprint);

  await writeFile(
    path.join(controllerDirectory, "untracked.ts"),
    "export const y = 2\n",
  );
  const untrackedChange = await resolveControllerSource(controllerDirectory);
  expect(untrackedChange.dirty).toBe(true);
  expect(untrackedChange.fingerprint).not.toBe(trackedChange.fingerprint);
});
