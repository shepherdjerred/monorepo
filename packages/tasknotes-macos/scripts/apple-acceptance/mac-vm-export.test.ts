import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { acceptanceStateWritePrefix, macFileSHA } from "./mac-artifact.ts";
import { loadMacVMExport, recordUnstartedMacVM } from "./mac-vm-export.ts";
import { publishMacEvidence } from "./mac-evidence.ts";
import type { MacJourneyCommand } from "./mac-journey.ts";

const directories: string[] = [];
const buildID = "12345678-1234-1234-1234-123456789abc",
  head = "a".repeat(40);
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true });
});
async function fixture() {
  const directory = await realpath(
    await mkdtemp(path.join(tmpdir(), "facet-vm-export-contract-")),
  );
  directories.push(directory);
  const root = path.join(directory, "packages/tasknotes-macos"),
    base = path.join(root, ".build/occurrence-vm"),
    exported = path.join(base, "exports", buildID),
    built = path.join(base, "builds", buildID);
  await mkdir(exported, { recursive: true });
  await mkdir(built, { recursive: true });
  const sources: Record<string, string> = {};
  for (const relative of [
    "owned.swift",
    "packages/tasknotes-macos/scripts/apple-acceptance/mac-process-owner.swift",
    "packages/tasknotes-macos/scripts/apple-acceptance/occurrence-launches.schema.json",
  ].sort()) {
    const file = path.join(directory, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, relative);
    sources[relative] = await macFileSHA(file);
  }
  const files: Record<string, { sha256: string; mode: number }> = {};
  const plan = "TaskNotesAcceptance_macosx27.0-arm64.xctestrun";
  for (const relative of [
    plan,
    "Debug/FacetAcceptance.app/Contents/MacOS/App",
    "Debug/TaskNotesAcceptanceUITests-Runner.app/Contents/MacOS/Runner",
  ]) {
    const file = path.join(exported, "products", relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, relative, { mode: 0o600 });
    files[relative] = { sha256: await macFileSHA(file), mode: 0o600 };
  }
  const artifact = {
    schemaVersion: 1,
    runID: buildID,
    sourceHead: head,
    packageRoot: root,
    xcodeVersion: "Xcode fixture",
    sources,
    files,
    links: {},
  };
  const artifactText = JSON.stringify(artifact);
  await writeFile(path.join(built, "artifact.json"), artifactText);
  await writeFile(path.join(exported, "artifact.json"), artifactText);
  for (const name of [
    "mac-process-owner.swift",
    "occurrence-launches.schema.json",
  ])
    await writeFile(
      path.join(exported, name),
      await readFile(path.join(root, "scripts/apple-acceptance", name)),
    );
  await writeFile(path.join(exported, "guest.js"), "owned-bundle");
  await writeFile(
    path.join(exported, "payload.json"),
    JSON.stringify({
      schemaVersion: 1,
      artifactSHA256: await macFileSHA(path.join(exported, "artifact.json")),
      guestBundleSHA256: await macFileSHA(path.join(exported, "guest.js")),
    }),
  );
  const prepared = path.join(built, "prepared.json");
  await writeFile(
    prepared,
    JSON.stringify({
      schemaVersion: 1,
      status: "prepared",
      buildID,
      sourceHead: head,
      payloadSHA256: await macFileSHA(path.join(exported, "payload.json")),
      testsRun: 0,
      nativeTestStarted: false,
    }),
  );
  let currentHead = head;
  const calls: string[][] = [];
  const command: MacJourneyCommand = async (argv) => {
    calls.push(argv);
    if (argv.includes("build-for-testing") || argv[0] === "bun")
      throw Error("Replay invoked producer");
    if (argv[0] === "git")
      return argv.includes("ls-files")
        ? Object.keys(sources).join("\0")
        : currentHead;
    if (argv[0] === "plutil")
      return JSON.stringify(
        argv.at(-1)?.includes("FacetAcceptance.app.plist")
          ? { "com.apple.security.app-sandbox": true }
          : {
              "com.apple.security.app-sandbox": true,
              "com.apple.security.get-task-allow": true,
              "com.apple.security.temporary-exception.files.absolute-path.read-only":
                ["/"],
              "com.apple.security.temporary-exception.sbpl": [
                "(allow hid-control)",
                "(allow signal)",
              ],
              "com.apple.security.temporary-exception.files.home-relative-path.read-write":
                [acceptanceStateWritePrefix],
            },
      );
    return "";
  };
  return {
    root,
    exported,
    prepared,
    command,
    calls,
    plan,
    setHead: (value: string) => {
      currentHead = value;
    },
  };
}
test("explicit export reuse is stable and never invokes its producer", async () => {
  const f = await fixture();
  const first = await loadMacVMExport(f.root, buildID, f.command),
    second = await loadMacVMExport(f.root, buildID, f.command);
  expect(second).toEqual(first);
  expect(f.calls.some((argv) => argv.includes("build-for-testing"))).toBe(
    false,
  );
  f.setHead("b".repeat(40));
  await expect(loadMacVMExport(f.root, buildID, f.command)).rejects.toThrow(
    "source revision",
  );
  f.setHead(head);
  await writeFile(path.resolve(f.root, "../../owned.swift"), "changed source");
  await expect(loadMacVMExport(f.root, buildID, f.command)).rejects.toThrow(
    "inputs changed",
  );
});
test("immutable exported xctestrun and bundle tampering fail before replay", async () => {
  const f = await fixture();
  await writeFile(path.join(f.exported, "products", f.plan), "changed plan");
  await expect(loadMacVMExport(f.root, buildID, f.command)).rejects.toThrow(
    "test configuration",
  );
  const other = await fixture();
  await writeFile(path.join(other.exported, "guest.js"), "changed bundle");
  await expect(
    loadMacVMExport(other.root, buildID, other.command),
  ).rejects.toThrow();
});
test("prepared receipt must be an owned regular bounded input", async () => {
  const f = await fixture();
  const target = path.join(path.dirname(f.prepared), "real.json");
  await writeFile(target, await readFile(f.prepared));
  await unlink(f.prepared);
  await symlink(target, f.prepared);
  await expect(loadMacVMExport(f.root, buildID, f.command)).rejects.toThrow();
  const other = await fixture();
  await writeFile(other.prepared, "{");
  await expect(
    loadMacVMExport(other.root, buildID, other.command),
  ).rejects.toThrow();
});
test("prelaunch failure publishes evidence only after real owned-retirement acknowledgement", async () => {
  const directory = await realpath(
    await mkdtemp(path.join(tmpdir(), "facet-vm-prelaunch-proof-")),
  );
  directories.push(directory);
  const binding = {
    runID: buildID,
    descriptor: "/owned/acceptance.json",
    executable: "/owned/App",
  };
  await writeFile(
    path.join(directory, "vm-error.json"),
    JSON.stringify({ status: "failed", nativeTestStarted: false }),
  );
  await recordUnstartedMacVM(binding, directory, async (received, journal) => {
    expect(received).toEqual(binding);
    expect(journal).toBeNull();
    return { signalSubmitted: false, observedExit: true };
  });
  await publishMacEvidence(directory, buildID);
  expect(
    JSON.parse(
      await readFile(path.join(directory, "transport.json"), "utf8"),
    ).files.map((f: { path: string }) => f.path),
  ).toContain("vm-error.json");
  const rejected = await realpath(
    await mkdtemp(path.join(tmpdir(), "facet-vm-prelaunch-rejected-")),
  );
  directories.push(rejected);
  await expect(
    recordUnstartedMacVM(binding, rejected, async () => {
      throw Error("Unproven process ownership");
    }),
  ).rejects.toThrow("ownership");
  await expect(publishMacEvidence(rejected, buildID)).rejects.toThrow();
});
