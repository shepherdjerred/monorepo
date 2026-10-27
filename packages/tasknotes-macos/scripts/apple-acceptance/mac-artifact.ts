import assert from "node:assert/strict";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readlink,
  realpath,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import type { MacJourneyCommand } from "./mac-journey.ts";

export type MacArtifact = {
  schemaVersion: 1;
  runID: string;
  packageRoot: string;
  sourceHead: string;
  xcodeVersion: string;
  sources: Record<string, string>;
  files: Record<string, { sha256: string; mode: number }>;
  links: Record<string, string>;
};
export const macUUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
export function safeMacRelative(file: string): void {
  assert.ok(
    file.length > 0 &&
      file.length <= 4096 &&
      !file.includes("\0") &&
      !path.isAbsolute(file) &&
      file
        .split("/")
        .every(
          (part) =>
            part !== ".." &&
            part !== "." &&
            part !== "" &&
            part !== "__proto__" &&
            part !== "constructor" &&
            part !== "prototype",
        ),
  );
}
export async function macFileSHA(file: string): Promise<string> {
  const hash = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(file).stream()) hash.update(chunk);
  return hash.digest("hex");
}
const runtimeRoots = [
  "Debug/FacetAcceptance.app/",
  "Debug/TaskNotesAcceptanceUITests-Runner.app/",
  "Debug/PackageFrameworks/TaskNotesCore.framework/",
];
export function macRuntimeFile(file: string): boolean {
  return (
    runtimeRoots.some((root) => file.startsWith(root)) ||
    /^TaskNotesAcceptance_macosx[^/]+\.xctestrun$/u.test(file)
  );
}
export const acceptanceStateWritePrefix =
  "/Library/Containers/red.sjer.tasknotes.mac.acceptance/Data/Library/Application Support/FacetAcceptance/";
const homeWriteKey =
  "com.apple.security.temporary-exception.files.home-relative-path.read-write";
/** Validate the effective signature, including Xcode's injected runner policy. */
export function validateMacCapabilities(
  raw: unknown,
  role: "app" | "runner",
): void {
  assert.ok(raw !== null && typeof raw === "object" && !Array.isArray(raw));
  assert.equal(
    Reflect.get(raw, "com.apple.security.app-sandbox"),
    true,
    "App and runner must remain sandboxed",
  );
  const writes = Object.keys(raw).filter(
    (key) =>
      key.startsWith("com.apple.security.temporary-exception.files.") &&
      key.endsWith(".read-write"),
  );
  assert.deepEqual(
    writes,
    role === "runner" ? [homeWriteKey] : [],
    "Unexpected static filesystem write capability",
  );
  if (role === "app") {
    assert.equal(
      Reflect.get(raw, "com.apple.security.temporary-exception.sbpl"),
      undefined,
      "App must not inherit runner sandbox overrides",
    );
    return;
  }
  const homeWrites: unknown = Reflect.get(raw, homeWriteKey);
  assert.ok(
    Array.isArray(homeWrites) &&
      homeWrites.length > 0 &&
      homeWrites.every(
        (prefix: unknown) => prefix === acceptanceStateWritePrefix,
      ),
    "Runner write access must be confined to synthetic acceptance state",
  );
  assert.equal(Reflect.get(raw, "com.apple.security.get-task-allow"), true);
  const readOnly: unknown = Reflect.get(
    raw,
    "com.apple.security.temporary-exception.files.absolute-path.read-only",
  );
  assert.ok(
    Array.isArray(readOnly) && readOnly.includes("/"),
    "Preserve SDK runner read policy",
  );
  const policy: unknown = Reflect.get(
    raw,
    "com.apple.security.temporary-exception.sbpl",
  );
  assert.ok(
    Array.isArray(policy) &&
      policy.includes("(allow hid-control)") &&
      policy.includes("(allow signal)") &&
      policy.every(
        (rule: unknown) =>
          rule === "(allow hid-control)" || rule === "(allow signal)",
      ),
    "Unexpected runner sandbox policy override",
  );
  for (const key of Object.keys(raw))
    assert.ok(
      !(
        key.startsWith("com.apple.security.files.") &&
        key.endsWith(".read-write")
      ),
      "Unexpected runner file-selection write capability",
    );
}
export function readMacArtifact(raw: unknown): MacArtifact {
  assert.ok(raw !== null && typeof raw === "object" && !Array.isArray(raw));
  assert.deepEqual(
    Object.keys(raw).sort(),
    [
      "schemaVersion",
      "runID",
      "packageRoot",
      "sourceHead",
      "xcodeVersion",
      "sources",
      "files",
      "links",
    ].sort(),
  );
  const get = (key: string): unknown => Reflect.get(raw, key);
  const text = (key: string): string => {
    const value = get(key);
    assert.ok(typeof value === "string");
    return value;
  };
  const map = (key: string): Record<string, unknown> => {
    const value = get(key);
    assert.ok(
      value !== null && typeof value === "object" && !Array.isArray(value),
    );
    return Object.fromEntries(Object.entries(value));
  };
  assert.equal(get("schemaVersion"), 1);
  const runID = text("runID"),
    packageRoot = text("packageRoot"),
    sourceHead = text("sourceHead");
  assert.match(runID, macUUID);
  assert.match(sourceHead, /^[a-f0-9]{40}$/u);
  assert.equal(path.resolve(packageRoot), packageRoot);
  const sources: Record<string, string> = {},
    files: MacArtifact["files"] = {},
    links: Record<string, string> = {};
  for (const [file, value] of Object.entries(map("sources"))) {
    safeMacRelative(file);
    assert.ok(
      typeof value === "string" &&
        (value === "deleted" || /^[a-f0-9]{64}$/u.test(value)),
    );
    sources[file] = value;
  }
  for (const [file, value] of Object.entries(map("files"))) {
    safeMacRelative(file);
    assert.ok(value !== null && typeof value === "object");
    assert.deepEqual(Object.keys(value).sort(), ["mode", "sha256"]);
    const sha256: unknown = Reflect.get(value, "sha256"),
      mode: unknown = Reflect.get(value, "mode");
    assert.ok(typeof sha256 === "string" && /^[a-f0-9]{64}$/u.test(sha256));
    assert.ok(
      typeof mode === "number" &&
        Number.isInteger(mode) &&
        mode >= 0 &&
        mode <= 0o777,
    );
    files[file] = { sha256, mode };
  }
  for (const [file, value] of Object.entries(map("links"))) {
    safeMacRelative(file);
    assert.ok(typeof value === "string");
    safeMacRelative(value);
    assert.ok(files[file] === undefined);
    links[file] = value;
  }
  const directories = new Set<string>();
  for (const file of Object.keys(files))
    for (
      let parent = path.posix.dirname(file);
      parent !== ".";
      parent = path.posix.dirname(parent)
    )
      directories.add(parent);
  assert.ok(
    Object.keys(sources).length <= 20_000 &&
      Object.keys(files).length <= 20_000 &&
      Object.keys(links).length <= 1_000,
  );
  for (const file of [...Object.keys(files), ...Object.keys(links)])
    for (
      let parent = path.posix.dirname(file);
      parent !== ".";
      parent = path.posix.dirname(parent)
    )
      assert.ok(
        files[parent] === undefined && links[parent] === undefined,
        "Artifact entries overlap physical ancestors",
      );
  for (const file of Object.keys(links)) {
    let resolved = file;
    const seen = new Set<string>();
    while (true) {
      const segments = resolved.split("/");
      const prefix = segments
        .map((_, index) => segments.slice(0, index + 1).join("/"))
        .find((part) => links[part] !== undefined);
      if (prefix === undefined) {
        assert.ok(
          files[resolved] !== undefined || directories.has(resolved),
          "Dangling artifact link",
        );
        if (macRuntimeFile(file))
          assert.ok(
            macRuntimeFile(resolved),
            "Runtime link escapes copied products",
          );
        break;
      }
      assert.ok(!seen.has(prefix), "Cyclic artifact link");
      seen.add(prefix);
      const target = links[prefix];
      assert.ok(target !== undefined);
      resolved = path.posix.join(
        path.posix.dirname(prefix),
        target,
        resolved.slice(prefix.length),
      );
      safeMacRelative(resolved);
    }
  }
  assert.ok(
    Object.keys(sources).length > 0 && Object.keys(files).some(macRuntimeFile),
  );
  return {
    schemaVersion: 1,
    runID,
    packageRoot,
    sourceHead,
    xcodeVersion: text("xcodeVersion"),
    sources,
    files,
    links,
  };
}
export async function verifyMacArtifact(
  artifact: MacArtifact,
  products: string,
  command: MacJourneyCommand,
  capabilityDirectory = path.dirname(products),
): Promise<void> {
  for (const [file, expected] of Object.entries(artifact.files))
    if (macRuntimeFile(file) && !file.endsWith(".xctestrun")) {
      const actual = path.join(products, file),
        metadata = await lstat(actual);
      assert.ok(metadata.isFile() && !metadata.isSymbolicLink());
      assert.ok(process.getuid);
      assert.equal(metadata.uid, process.getuid());
      assert.equal(metadata.mode & 0o777, expected.mode);
      assert.equal(await macFileSHA(actual), expected.sha256);
    }
  for (const [file, target] of Object.entries(artifact.links))
    if (macRuntimeFile(file))
      assert.equal(await readlink(path.join(products, file)), target);
  for (const app of [
    "FacetAcceptance.app",
    "TaskNotesAcceptanceUITests-Runner.app",
  ]) {
    await command([
      "codesign",
      "--verify",
      "--deep",
      "--strict",
      path.join(products, "Debug", app),
    ]);
    const entitlementFile = path.join(
      capabilityDirectory,
      `capabilities-${app}.plist`,
    );
    await command([
      "codesign",
      "--display",
      "--xml",
      "--entitlements",
      entitlementFile,
      path.join(products, "Debug", app),
    ]);
    const capabilities: unknown = JSON.parse(
      await command(
        ["plutil", "-convert", "json", "-o", "-", entitlementFile],
        true,
      ),
    );
    validateMacCapabilities(
      capabilities,
      app === "FacetAcceptance.app" ? "app" : "runner",
    );
  }
}
/** Physical files first, then validated exact links; never traverse VirtioFS framework links. */
export async function materializeMacArtifact(
  artifact: MacArtifact,
  source: string,
  destination: string,
): Promise<void> {
  readMacArtifact(artifact);
  const files = Object.entries(artifact.files).filter(([file]) =>
    macRuntimeFile(file),
  );
  const links = Object.entries(artifact.links).filter(([file]) =>
    macRuntimeFile(file),
  );
  for (const [file, expected] of files) {
    const metadata = await lstat(path.join(source, file));
    assert.ok(metadata.isFile() && !metadata.isSymbolicLink());
    assert.equal(metadata.mode & 0o7000, 0);
    assert.equal(metadata.mode & 0o777, expected.mode);
    assert.equal(await macFileSHA(path.join(source, file)), expected.sha256);
  }
  for (const [file, target] of links) {
    assert.ok((await lstat(path.join(source, file))).isSymbolicLink());
    assert.equal(await readlink(path.join(source, file)), target);
  }
  assert.equal(
    await realpath(path.dirname(destination)),
    path.dirname(destination),
  );
  await mkdir(destination, { recursive: false });
  for (const [file, expected] of files) {
    const target = path.join(destination, file);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(source, file), target, 1);
    await chmod(target, expected.mode);
  }
  for (const [file, target] of links) {
    await mkdir(path.dirname(path.join(destination, file)), {
      recursive: true,
    });
    await symlink(target, path.join(destination, file));
  }
}
