import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
  acceptanceStateWritePrefix,
  macFileSHA,
  type MacArtifact,
} from "./mac-artifact.ts";
import type { MacJourneyCommand } from "./mac-journey.ts";
import { installMacVMRunner } from "./mac-vm-runner.ts";

const roots: string[] = [];
const runID = "12345678-1234-1234-1234-123456789abc";
const nextID = "22345678-1234-1234-1234-123456789abc";
const prefix = "Debug/TaskNotesAcceptanceUITests-Runner.app";
const executable = `${prefix}/Contents/MacOS/TaskNotesAcceptanceUITests-Runner`;
const capabilities = {
  "com.apple.security.app-sandbox": true,
  "com.apple.security.get-task-allow": true,
  "com.apple.security.temporary-exception.files.absolute-path.read-only": ["/"],
  "com.apple.security.temporary-exception.files.home-relative-path.read-write":
    [acceptanceStateWritePrefix],
  "com.apple.security.temporary-exception.sbpl": [
    "(allow hid-control)",
    "(allow signal)",
  ],
};

async function fixture() {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "facet-stable-runner-")),
  );
  roots.push(root);
  vi.spyOn(os, "homedir").mockReturnValue(root);
  const products = path.join(root, "source");
  await mkdir(path.join(products, prefix, "Contents/MacOS"), {
    recursive: true,
  });
  const files: MacArtifact["files"] = {};
  for (const [file, text, mode] of [
    [executable, "signed runner bytes", 0o755],
    [`${prefix}/Contents/Info.plist`, "signed identity metadata", 0o644],
  ] as const) {
    await Bun.write(path.join(products, file), text);
    await chmod(path.join(products, file), mode);
    files[file] = { sha256: await macFileSHA(path.join(products, file)), mode };
  }
  const link = `${prefix}/Contents/Current`;
  await symlink("MacOS", path.join(products, link));
  const artifact: MacArtifact = {
    schemaVersion: 1,
    runID,
    packageRoot: root,
    sourceHead: "a".repeat(40),
    xcodeVersion: "Xcode owned",
    sources: { "owned.swift": "b".repeat(64) },
    files,
    links: { [link]: "MacOS" },
  };
  const calls: string[][] = [];
  let live = "0",
    failSignature = false;
  const command: MacJourneyCommand = async (argv) => {
    calls.push(argv);
    if (argv[0] === "xcrun") return live;
    if (argv[0] === "codesign") {
      if (failSignature) throw new Error("signature rejected");
      return "";
    }
    if (argv[0] === "plutil") return JSON.stringify(capabilities);
    throw new Error("Unexpected command");
  };
  const namespace = path.join(
    root,
    "Library/Application Support/FacetAcceptanceHarness/Runner",
  );
  return {
    root,
    products,
    artifact,
    command,
    calls,
    namespace,
    setLive: (value: string) => {
      live = value;
    },
    rejectSignature: () => {
      failSignature = true;
    },
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

test("installs only exact Runner bytes and relative links, retaining a run-owned lease", async () => {
  const context = await fixture();
  const installed = await installMacVMRunner(
    context.artifact,
    context.products,
    runID,
    context.command,
  );
  expect(installed.bundlePath).toBe(
    path.join(context.namespace, "current", prefix),
  );
  expect(
    await readFile(path.join(context.namespace, "current", executable), "utf8"),
  ).toBe("signed runner bytes");
  expect(
    await readlink(path.join(installed.bundlePath, "Contents/Current")),
  ).toBe("MacOS");
  expect(
    context.calls.filter(
      (args) => args[0] === "codesign" && args[1] === "--verify",
    ),
  ).toHaveLength(2);
  for (const args of context.calls.filter((argv) =>
    argv.includes("--entitlements"),
  ))
    expect(args[args.indexOf("--entitlements") + 1]).toBe(
      path.join(context.namespace, `capabilities-${runID}.plist`),
    );
  await expect(
    installMacVMRunner(
      context.artifact,
      context.products,
      nextID,
      context.command,
    ),
  ).rejects.toThrow();
  await installed.release();
  await expect(lstat(path.join(context.namespace, "lease"))).rejects.toThrow();
});

test("identical installation reuses the signed inode and metadata without writes", async () => {
  const context = await fixture();
  const first = await installMacVMRunner(
    context.artifact,
    context.products,
    runID,
    context.command,
  );
  const binary = path.join(context.namespace, "current", executable);
  const before = await lstat(binary),
    marker = path.join(context.namespace, "current/installation.json");
  const original = await readFile(marker, "utf8");
  await first.release();
  const second = await installMacVMRunner(
    context.artifact,
    context.products,
    nextID,
    context.command,
  );
  expect(second.installationID).toBe(first.installationID);
  expect(await lstat(binary)).toMatchObject({
    ino: before.ino,
    mtimeMs: before.mtimeMs,
  });
  expect(await readFile(marker, "utf8")).toBe(original);
  await expect(
    lstat(path.join(context.namespace, `stage-${nextID}`)),
  ).rejects.toThrow();
  await second.release();
});

test("unknown existing installation is preserved and cannot be adopted", async () => {
  const context = await fixture();
  await mkdir(path.join(context.namespace, "current"), { recursive: true });
  await Bun.write(path.join(context.namespace, "current/foreign"), "untouched");
  await expect(
    installMacVMRunner(
      context.artifact,
      context.products,
      runID,
      context.command,
    ),
  ).rejects.toThrow();
  expect(
    await readFile(path.join(context.namespace, "current/foreign"), "utf8"),
  ).toBe("untouched");
  await expect(lstat(path.join(context.namespace, "lease"))).rejects.toThrow();
});

test("live Runner blocks installation before code or policy commands", async () => {
  const context = await fixture();
  context.setLive("1");
  await expect(
    installMacVMRunner(
      context.artifact,
      context.products,
      runID,
      context.command,
    ),
  ).rejects.toThrow("still running");
  expect(context.calls).toHaveLength(1);
  await expect(
    lstat(path.join(context.namespace, "current")),
  ).rejects.toThrow();
});

test("tampered managed code fails without archival or replacement", async () => {
  const context = await fixture();
  const installed = await installMacVMRunner(
    context.artifact,
    context.products,
    runID,
    context.command,
  );
  await installed.release();
  await Bun.write(
    path.join(context.namespace, "current", executable),
    "tampered",
  );
  await expect(
    installMacVMRunner(
      context.artifact,
      context.products,
      nextID,
      context.command,
    ),
  ).rejects.toThrow();
  expect(
    await readFile(path.join(context.namespace, "current", executable), "utf8"),
  ).toBe("tampered");
  await expect(
    lstat(path.join(context.namespace, `archive-${nextID}`)),
  ).rejects.toThrow();
});

test("verified idle update archives the old exact code before installing new bytes", async () => {
  const context = await fixture();
  const installed = await installMacVMRunner(
    context.artifact,
    context.products,
    runID,
    context.command,
  );
  await installed.release();
  await Bun.write(path.join(context.products, executable), "new signed bytes");
  const previous = context.artifact.files[executable];
  expect(previous).toBeDefined();
  context.artifact.files[executable] = {
    mode: 0o755,
    sha256: await macFileSHA(path.join(context.products, executable)),
  };
  const updated = await installMacVMRunner(
    context.artifact,
    context.products,
    nextID,
    context.command,
  );
  expect(updated.installationID).not.toBe(installed.installationID);
  expect(
    await readFile(
      path.join(context.namespace, `archive-${nextID}`, executable),
      "utf8",
    ),
  ).toBe("signed runner bytes");
  expect(
    await readFile(path.join(context.namespace, "current", executable), "utf8"),
  ).toBe("new signed bytes");
  await updated.release();
});

test("signature failure preserves staged witness and releases only its own lease", async () => {
  const context = await fixture();
  context.rejectSignature();
  await expect(
    installMacVMRunner(
      context.artifact,
      context.products,
      runID,
      context.command,
    ),
  ).rejects.toThrow("signature rejected");
  expect(
    await readFile(
      path.join(context.namespace, `stage-${runID}`, executable),
      "utf8",
    ),
  ).toBe("signed runner bytes");
  await expect(
    lstat(path.join(context.namespace, "current")),
  ).rejects.toThrow();
  await expect(lstat(path.join(context.namespace, "lease"))).rejects.toThrow();
});

test("release rejects replacement ownership token without deleting the lease", async () => {
  const context = await fixture();
  const installed = await installMacVMRunner(
    context.artifact,
    context.products,
    runID,
    context.command,
  );
  const owner = path.join(context.namespace, "lease/owner.json");
  await Bun.write(owner, JSON.stringify({ runID: nextID }));
  await expect(installed.release()).rejects.toThrow();
  expect(await readFile(owner, "utf8")).toBe(JSON.stringify({ runID: nextID }));
});

test("installed verification tolerates a running case but rejects changed installation identity", async () => {
  const context = await fixture();
  const installed = await installMacVMRunner(
    context.artifact,
    context.products,
    runID,
    context.command,
  );
  context.setLive("1");
  await installed.verify();
  const file = path.join(context.namespace, "current/installation.json");
  const metadata = JSON.parse(await readFile(file, "utf8"));
  await Bun.write(
    file,
    JSON.stringify({ ...metadata, installationID: nextID }),
  );
  await expect(installed.verify()).rejects.toThrow("identity changed");
  await installed.release();
});
