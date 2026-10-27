import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  macFileSHA,
  macUUID,
  materializeMacArtifact,
  readMacArtifact,
  validateMacCapabilities,
  type MacArtifact,
} from "./mac-artifact.ts";
import type { MacJourneyCommand } from "./mac-journey.ts";

const runner = "Debug/TaskNotesAcceptanceUITests-Runner.app";
const marker = "installation.json";
const liveRunnerProbe = `import AppKit
print(NSRunningApplication.runningApplications(withBundleIdentifier: "red.sjer.tasknotes.mac.acceptance.uitests.xctrunner").filter { !$0.isTerminated }.count)`;

async function ownedDirectory(directory: string): Promise<void> {
  const metadata = await lstat(directory);
  assert.ok(metadata.isDirectory() && !metadata.isSymbolicLink());
  assert.equal(metadata.uid, process.getuid?.());
  assert.equal(
    metadata.mode & 0o022,
    0,
    "Runner namespace is writable by another user",
  );
  assert.equal(await realpath(directory), directory);
}

async function namespace(): Promise<string> {
  let directory = os.homedir();
  await ownedDirectory(directory);
  for (const part of [
    "Library",
    "Application Support",
    "FacetAcceptanceHarness",
    "Runner",
  ]) {
    directory = path.join(directory, part);
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      ))
        throw error;
    }
    await ownedDirectory(directory);
  }
  return directory;
}

function runnerArtifact(artifact: MacArtifact): MacArtifact {
  readMacArtifact(artifact);
  const included = (file: string) => file.startsWith(runner + "/");
  const result = readMacArtifact({
    ...artifact,
    files: Object.fromEntries(
      Object.entries(artifact.files).filter(([file]) => included(file)),
    ),
    links: Object.fromEntries(
      Object.entries(artifact.links).filter(([file]) => included(file)),
    ),
  });
  assert.ok(
    result.files[`${runner}/Contents/MacOS/TaskNotesAcceptanceUITests-Runner`],
  );
  assert.ok(result.files[`${runner}/Contents/Info.plist`]);
  return result;
}

async function present(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

async function verifyTree(
  root: string,
  artifact: MacArtifact,
  managed: boolean,
): Promise<void> {
  const expected = new Set([
    ...Object.keys(artifact.files),
    ...Object.keys(artifact.links),
  ]);
  if (managed) expected.add(marker);
  const directories = new Set<string>();
  for (const file of expected)
    for (
      let parent = path.dirname(file);
      parent !== ".";
      parent = path.dirname(parent)
    )
      directories.add(parent);
  async function visit(directory: string): Promise<void> {
    await ownedDirectory(directory);
    for (const name of await readdir(directory)) {
      const absolute = path.join(directory, name),
        relative = path.relative(root, absolute);
      const metadata = await lstat(absolute);
      assert.equal(metadata.uid, process.getuid?.());
      if (metadata.isDirectory()) {
        assert.ok(
          directories.has(relative),
          "Unexpected installed Runner directory",
        );
        await visit(absolute);
      } else {
        assert.ok(
          expected.delete(relative),
          "Unexpected installed Runner entry",
        );
        const target = artifact.links[relative];
        if (target !== undefined) {
          assert.ok(metadata.isSymbolicLink());
          assert.equal(await readlink(absolute), target);
        } else {
          assert.ok(metadata.isFile() && !metadata.isSymbolicLink());
          if (relative === marker) assert.equal(metadata.mode & 0o7777, 0o600);
          else {
            const file = artifact.files[relative];
            assert.ok(file);
            assert.equal(metadata.mode & 0o7777, file.mode);
            assert.equal(await macFileSHA(absolute), file.sha256);
          }
        }
      }
    }
  }
  await visit(root);
  assert.equal(expected.size, 0, "Installed Runner entries are missing");
}

async function signedRunner(
  root: string,
  output: string,
  command: MacJourneyCommand,
): Promise<void> {
  const bundle = path.join(root, runner);
  await command(["codesign", "--verify", "--deep", "--strict", bundle]);
  await command([
    "codesign",
    "--display",
    "--xml",
    "--entitlements",
    output,
    bundle,
  ]);
  validateMacCapabilities(
    JSON.parse(
      await command(["plutil", "-convert", "json", "-o", "-", output], true),
    ),
    "runner",
  );
}

async function installedMetadata(current: string) {
  await ownedDirectory(current);
  const file = path.join(current, marker),
    metadata = await lstat(file);
  assert.ok(metadata.isFile() && !metadata.isSymbolicLink());
  assert.equal(metadata.uid, process.getuid?.());
  assert.ok(metadata.size <= 4 * 1024 * 1024);
  const managed: unknown = JSON.parse(await readFile(file, "utf8"));
  assert.ok(
    managed !== null && typeof managed === "object" && !Array.isArray(managed),
  );
  assert.deepEqual(Object.keys(managed).sort(), [
    "artifact",
    "installationID",
    "schemaVersion",
  ]);
  assert.equal(Reflect.get(managed, "schemaVersion"), 1);
  const installationID: unknown = Reflect.get(managed, "installationID");
  assert.ok(typeof installationID === "string");
  assert.match(installationID, macUUID);
  return {
    installationID,
    artifact: runnerArtifact(readMacArtifact(Reflect.get(managed, "artifact"))),
  };
}

/** Serializes real guest Runner installation and keeps its signed path stable across fresh cases. */
export async function installMacVMRunner(
  artifact: MacArtifact,
  sourceProducts: string,
  runID: string,
  command: MacJourneyCommand,
): Promise<{
  bundlePath: string;
  installationID: string;
  verify: () => Promise<void>;
  release: () => Promise<void>;
}> {
  assert.match(runID, macUUID);
  assert.ok(process.getuid && process.getuid() !== 0);
  const ownerUID = process.getuid();
  const selected = runnerArtifact(artifact),
    root = await namespace();
  const lease = path.join(root, "lease"),
    token = JSON.stringify({ runID, nonce: crypto.randomUUID() });
  await mkdir(lease, { mode: 0o700 });
  const leaseIdentity = await lstat(lease);
  const tokenFile = path.join(lease, "owner.json");
  let tokenWritten = false;
  const requireLease = async () => {
    await ownedDirectory(lease);
    const actual = await lstat(lease);
    assert.equal(actual.dev, leaseIdentity.dev);
    assert.equal(actual.ino, leaseIdentity.ino);
    if (tokenWritten) {
      const metadata = await lstat(tokenFile);
      assert.ok(metadata.isFile() && !metadata.isSymbolicLink());
      assert.equal(metadata.uid, ownerUID);
      assert.equal(await readFile(tokenFile, "utf8"), token);
    }
  };
  const release = async () => {
    await requireLease();
    if (tokenWritten) await unlink(tokenFile);
    await rmdir(lease);
  };
  try {
    await writeFile(tokenFile, token, { flag: "wx", mode: 0o600 });
    tokenWritten = true;
    assert.equal(
      await command(["xcrun", "swift", "-e", liveRunnerProbe], true),
      "0",
      "A Runner is still running; never replace live signed code",
    );
    const current = path.join(root, "current"),
      output = path.join(root, `capabilities-${runID}.plist`);
    const installed = (installationID: string) => ({
      bundlePath: path.join(current, runner),
      installationID,
      release,
      verify: async () => {
        await requireLease();
        const managed = await installedMetadata(current);
        assert.equal(
          managed.installationID,
          installationID,
          "Runner installation identity changed",
        );
        assert.deepEqual(managed.artifact.files, selected.files);
        assert.deepEqual(managed.artifact.links, selected.links);
        await verifyTree(current, selected, true);
        await signedRunner(current, output, command);
      },
    });
    let previous: MacArtifact | undefined;
    if (await present(current)) {
      const managed = await installedMetadata(current);
      previous = managed.artifact;
      await verifyTree(current, previous, true);
      await signedRunner(current, output, command);
      if (
        isDeepStrictEqual(previous.files, selected.files) &&
        isDeepStrictEqual(previous.links, selected.links)
      )
        return installed(managed.installationID);
    }
    const staged = path.join(root, `stage-${runID}`),
      archived = path.join(root, `archive-${runID}`);
    assert.ok(
      !(await present(staged)) && !(await present(archived)),
      "Runner staging namespace already exists",
    );
    await materializeMacArtifact(selected, sourceProducts, staged);
    await verifyTree(staged, selected, false);
    await signedRunner(staged, output, command);
    const installationID = crypto.randomUUID();
    await writeFile(
      path.join(staged, marker),
      JSON.stringify({ schemaVersion: 1, installationID, artifact: selected }),
      { flag: "wx", mode: 0o600 },
    );
    await verifyTree(staged, selected, true);
    assert.equal(
      await command(["xcrun", "swift", "-e", liveRunnerProbe], true),
      "0",
      "A Runner appeared before installation",
    );
    if (previous) await rename(current, archived);
    await rename(staged, current);
    await verifyTree(current, selected, true);
    await signedRunner(current, output, command);
    return installed(installationID);
  } catch (error) {
    try {
      await release();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        "Runner installation and lease release failed",
      );
    }
    throw error;
  }
}
