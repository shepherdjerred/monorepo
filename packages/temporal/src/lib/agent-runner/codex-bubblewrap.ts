import { createHash } from "node:crypto";
import { lstat, readFile, realpath, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { z } from "zod/v4";
import rawPins from "./codex-bubblewrap-pins.json" with { type: "json" };

const PlatformPin = z.strictObject({
  package: z.string().min(1),
  packageVersion: z.string().min(1),
  targetTriple: z.string().min(1),
  helperSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  packageIntegrity: z.string().startsWith("sha512-"),
});
const pins = z
  .strictObject({
    codexVersion: z.string().min(1),
    platforms: z.strictObject({ arm64: PlatformPin, x64: PlatformPin }),
  })
  .parse(rawPins);
const PackageManifest = z.object({
  name: z.literal("@openai/codex"),
  version: z.string(),
});

export function codexBubblewrapPin(architecture: string) {
  if (architecture !== "arm64" && architecture !== "x64") {
    throw new Error("Unsupported bundled Codex bubblewrap architecture");
  }
  return Object.freeze({ ...pins.platforms[architecture] });
}

/** These validators accept observed facts; materialization always reads its own. */
export function assertRootProtectedMetadata(
  metadata: { uid: number; mode: number },
  allowRootStickyDirectory = false,
) {
  const writable = (metadata.mode & 0o022) !== 0;
  const rootSticky = allowRootStickyDirectory && (metadata.mode & 0o1000) !== 0;
  if (metadata.uid !== 0 || (writable && !rootSticky)) {
    throw new Error(
      "Codex bubblewrap path is not protected from provider writes",
    );
  }
}

export function assertCodexPackageVersion(manifest: unknown, expected: string) {
  if (PackageManifest.parse(manifest).version !== expected) {
    throw new Error(
      "Codex package version differs from the reviewed bubblewrap pin",
    );
  }
}

export function assertCodexBubblewrapDigest(
  observed: string,
  architecture: string,
) {
  if (observed !== codexBubblewrapPin(architecture).helperSha256) {
    throw new Error(
      "Bundled Codex bubblewrap digest differs from the reviewed artifact",
    );
  }
}

async function assertProtectedAncestors(
  filename: string,
  allowSticky: boolean,
) {
  for (
    let ancestor = path.dirname(filename);
    ;
    ancestor = path.dirname(ancestor)
  ) {
    const metadata = await lstat(ancestor);
    if (!metadata.isDirectory())
      throw new Error("Codex bubblewrap ancestor is not a directory");
    assertRootProtectedMetadata(metadata, allowSticky);
    if (ancestor === path.parse(ancestor).root) break;
  }
}

async function protectedExecutable(filename: string) {
  const canonical = await realpath(filename);
  const metadata = await lstat(canonical);
  if (!metadata.isFile() || (metadata.mode & 0o111) === 0) {
    throw new Error("Bundled Codex bubblewrap requires a regular executable");
  }
  assertRootProtectedMetadata(metadata);
  await assertProtectedAncestors(canonical, false);
  return canonical;
}

/** No runtime dependency injection: every production guard is mandatory. */
export async function materializeCodexBubblewrap(input: {
  codexLauncherPath: string;
  wrapperDirectory: string;
}) {
  if (process.platform !== "linux" || process.getuid?.() !== 0) {
    throw new Error("Bundled Codex bubblewrap requires the Linux root parent");
  }
  const pin = codexBubblewrapPin(process.arch);
  const cli = await protectedExecutable(input.codexLauncherPath);
  const cliRoot = path.dirname(path.dirname(cli));
  assertCodexPackageVersion(
    JSON.parse(await readFile(path.join(cliRoot, "package.json"), "utf8")),
    pins.codexVersion,
  );
  const packageJson = createRequire(cli).resolve(`${pin.package}/package.json`);
  assertCodexPackageVersion(
    JSON.parse(await readFile(packageJson, "utf8")),
    pin.packageVersion,
  );
  const helper = await protectedExecutable(
    path.join(
      path.dirname(packageJson),
      "vendor",
      pin.targetTriple,
      "codex-resources",
      "bwrap",
    ),
  );
  const digest = createHash("sha256")
    .update(await readFile(helper))
    .digest("hex");
  assertCodexBubblewrapDigest(digest, process.arch);
  const directory = await realpath(input.wrapperDirectory);
  if (directory !== path.resolve(input.wrapperDirectory)) {
    throw new Error("Codex bubblewrap alias directory has a symlink ancestor");
  }
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || (metadata.mode & 0o005) !== 0o005) {
    throw new Error("Codex bubblewrap alias directory must be traversable");
  }
  assertRootProtectedMetadata(metadata);
  // mkdtemp under root-owned sticky /tmp is protected against UID 1001 rename.
  await assertProtectedAncestors(directory, true);
  await symlink(helper, path.join(directory, "bwrap"));
}
