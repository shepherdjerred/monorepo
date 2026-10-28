import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { childEnvironment } from "tasknotes-macos/scripts/mac-account-contract.ts";
import {
  packageRoot,
  runDirectory,
  type Manifest,
} from "../apple-sync-live/model";
import { boundedCommand } from "tasknotes-macos/scripts/apple-acceptance/bounded-command.ts";

export const InputArtifactsSchema = z.strictObject({
  bridge: z.string().regex(/^[a-f0-9]{64}$/u),
  owner: z.string().regex(/^[a-f0-9]{64}$/u),
});
export type InputArtifacts = z.infer<typeof InputArtifactsSchema>;
export const ProcessLifetimeSchema = z.strictObject({
  uid: z.number().int().positive(),
  ruid: z.number().int().positive(),
  startSeconds: z.number().int().positive(),
  startMicroseconds: z.number().int().min(0).max(999_999),
});
export type ProcessLifetime = z.infer<typeof ProcessLifetimeSchema>;
export async function inputBinary(file: string) {
  const before = await lstat(file);
  assert.ok(
    before.isFile() &&
      !before.isSymbolicLink() &&
      before.uid === process.getuid?.() &&
      (before.mode & 0o777) === 0o700 &&
      (await realpath(file)) === file,
    "Private input executable ownership changed",
  );
  const bytes = await readFile(file),
    after = await lstat(file);
  assert.ok(
    after.ino === before.ino &&
      after.dev === before.dev &&
      after.mtimeMs === before.mtimeMs &&
      after.size === bytes.length,
  );
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}
export function inputArtifactDirectory(runID: string) {
  return path.join(runDirectory(runID), "ios-account/native");
}
/** Includes Debug dylibs and test plugins, rather than trusting only launcher stubs. */
export async function inputBundle(directory: string) {
  const root = await lstat(directory);
  assert.ok(
    root.isDirectory() &&
      !root.isSymbolicLink() &&
      root.uid === process.getuid?.() &&
      (await realpath(directory)) === directory,
  );
  const files: Record<string, string> = {};
  for (const relative of [
    ...new Bun.Glob("**/*").scanSync({
      cwd: directory,
      dot: true,
      onlyFiles: false,
    }),
  ].sort()) {
    const file = path.join(directory, relative),
      before = await lstat(file);
    assert.ok(
      !before.isSymbolicLink() && before.uid === root.uid,
      "Private input bundle ownership changed",
    );
    if (before.isDirectory()) continue;
    assert.ok(
      before.isFile(),
      "Private input bundle contains an unsupported entry",
    );
    const bytes = await readFile(file),
      after = await lstat(file);
    assert.ok(
      before.dev === after.dev &&
        before.ino === after.ino &&
        before.mtimeMs === after.mtimeMs &&
        before.size === bytes.length,
    );
    files[relative] = new Bun.CryptoHasher("sha256")
      .update(bytes)
      .digest("hex");
  }
  return files;
}
export async function inputArtifacts(runID: string) {
  const directory = inputArtifactDirectory(runID);
  const parent = await lstat(directory);
  assert.ok(
    parent.isDirectory() &&
      !parent.isSymbolicLink() &&
      parent.uid === process.getuid?.() &&
      (parent.mode & 0o777) === 0o700 &&
      (await realpath(directory)) === directory,
  );
  const profile = path.join(directory, "artifacts.json");
  const before = await lstat(profile);
  assert.ok(
    before.isFile() &&
      !before.isSymbolicLink() &&
      before.uid === process.getuid() &&
      before.size <= 65_536 &&
      (before.mode & 0o777) === 0o600,
  );
  const bytes = await readFile(profile),
    after = await lstat(profile);
  assert.ok(
    before.dev === after.dev &&
      before.ino === after.ino &&
      before.mtimeMs === after.mtimeMs &&
      before.size === bytes.length,
  );
  const recorded = InputArtifactsSchema.parse(
    JSON.parse(bytes.toString("utf8")),
  );
  assert.deepEqual(
    {
      bridge: await inputBinary(path.join(directory, "bridge")),
      owner: await inputBinary(path.join(directory, "owner")),
    },
    recorded,
  );
  return recorded;
}
export async function prepareInputArtifacts(
  manifest: Manifest,
  evidence: string,
  operation: "probe" | "credentials",
) {
  if (operation === "credentials") return inputArtifacts(manifest.runID);
  const directory = inputArtifactDirectory(manifest.runID);
  await mkdir(directory, { mode: 0o700 });
  const command = (argv: string[]) =>
    boundedCommand(argv, {
      cwd: packageRoot,
      logs: path.join(evidence, "commands"),
      timeoutMS: 180_000,
      capture: false,
    });
  for (const [name, source] of [
    ["bridge", path.join(import.meta.dir, "native/bridge.swift")],
    [
      "owner",
      path.resolve(
        packageRoot,
        "../tasknotes-macos/scripts/apple-acceptance/mac-process-owner.swift",
      ),
    ],
  ] as const) {
    await command([
      "/usr/bin/xcrun",
      "swiftc",
      // Preserve the canonical owner's existing compile contract; only the new pump is Swift 6.
      ...(name === "bridge" ? ["-swift-version", "6"] : []),
      source,
      "-o",
      path.join(directory, name),
    ]);
    await chmod(path.join(directory, name), 0o700);
  }
  const artifacts = {
    bridge: await inputBinary(path.join(directory, "bridge")),
    owner: await inputBinary(path.join(directory, "owner")),
  };
  await writeFile(
    path.join(directory, "artifacts.json"),
    JSON.stringify(artifacts),
    { flag: "wx", mode: 0o600 },
  );
  return artifacts;
}

/** Only closed process metadata crosses this existing canonical public Darwin boundary. */
export async function inspectInputOwner(
  directory: string,
  artifacts: InputArtifacts,
  pid: number,
  target: { executable: string; expected?: ProcessLifetime | undefined },
) {
  assert.equal(
    await inputBinary(path.join(directory, "owner")),
    artifacts.owner,
  );
  const child = Bun.spawn([path.join(directory, "owner")], {
    env: childEnvironment(Bun.env),
    stdin: Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        operation: "inspect",
        pid,
        executable: await realpath(target.executable),
        expected: null,
      }),
    ),
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => {
    child.kill("SIGTERM");
  }, 5000);
  try {
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    assert.ok(
      exit === 0 && stderr === "",
      "Private input process ownership was rejected",
    );
    const parsed = z
      .strictObject({
        schemaVersion: z.literal(1),
        operation: z.literal("inspect"),
        pid: z.literal(pid),
        outcome: z.literal("inspected"),
        identity: ProcessLifetimeSchema,
        reason: z.null(),
        signalSubmitted: z.literal(false),
      })
      .safeParse(JSON.parse(stdout));
    if (!parsed.success)
      throw new Error("Private input owner returned an invalid receipt");
    if (target.expected !== undefined)
      assert.deepEqual(
        parsed.data.identity,
        target.expected,
        "Private input process lifetime changed",
      );
    return parsed.data.identity;
  } finally {
    clearTimeout(timer);
  }
}
