import { mkdir, lstat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { command } from "./process.ts";
import {
  RuntimeSourcePathSchema,
  verifyRuntimeInputs,
} from "./runtime-sources.ts";
import { retainBlob, cachedBlob, type BlobStore } from "./store.ts";
import { CACHE_DIR } from "#protocol/paths.ts";
import { ensureArtifact, paperJarName } from "#sandbox/artifacts.ts";
import {
  paper,
  worldEdit,
  citizens,
  coreProtect,
  luckPerms,
  multiverseCore,
} from "#src/pins.ts";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const dependencyPath = z
  .string()
  .regex(/^(?:paper-[\w.-]+\.jar|plugins\/[\w.-]+\.jar)$/u);
export const RuntimeSchema = z.strictObject({
  schema: z.literal(1),
  revision: z.string().regex(/^[a-f0-9]{40}$/u),
  patch: hash,
  files: z.array(
    z.strictObject({ path: RuntimeSourcePathSchema, sha256: hash }),
  ),
  artifacts: z.array(
    z.strictObject({ path: RuntimeSourcePathSchema, sha256: hash }),
  ),
  dependencies: z
    .array(z.strictObject({ path: dependencyPath, sha256: hash }))
    .min(1),
});
const sourceRoots = [
  "packages/mc-harness",
  "packages/the-storm",
  "packages/toolkit",
  "packages/homelab/scripts/minecraft",
  "bun.lock",
  "package.json",
];
const artifacts = [
  "packages/the-storm/plugin/dist/build/libs/TheStorm.jar",
  "packages/the-storm/plugin/bridge/build/libs/MCBridge.jar",
  "packages/the-storm/client/build/libs/the-storm-client-1.0.0.jar",
];
export async function retainRuntime(
  repoRoot: string,
  store: BlobStore,
): Promise<string> {
  await verifyRuntimeInputs(repoRoot);
  const git = (args: string[]) => command(["git", "-C", repoRoot, ...args]);
  const revisionOutput = await git(["rev-parse", "HEAD"]);
  const revision = revisionOutput.trim();
  const patchText = await git([
    "diff",
    "--binary",
    "HEAD",
    "--",
    ...sourceRoots,
  ]);
  const files = [];
  const untrackedOutput = await git([
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    ...sourceRoots,
  ]);
  const untracked = untrackedOutput.split("\0").filter(Boolean);
  const sources: { path: string; bytes: Uint8Array }[] = [];
  for (const relative of untracked) {
    RuntimeSourcePathSchema.parse(relative);
    if (
      !/\.(?:ts|js|json|java|yml|yaml|xml|toml|kts|sql|properties|md)$/u.test(
        relative,
      )
    )
      throw new Error(`Untracked runtime input is not source: ${relative}`);
    const file = path.join(repoRoot, relative);
    const metadata = await lstat(file);
    if (!metadata.isFile()) throw new Error("Linked runtime source input");
    sources.push({
      path: relative,
      bytes: new Uint8Array(await Bun.file(file).arrayBuffer()),
    });
  }
  await command(
    ["gitleaks", "stdin", "--redact", "--no-banner"],
    patchText +
      sources.map((s) => new TextDecoder().decode(s.bytes)).join("\n"),
  );
  const patch = await retainBlob(store, new TextEncoder().encode(patchText));
  for (const source of sources)
    files.push({
      path: source.path,
      sha256: await retainBlob(store, source.bytes),
    });
  const built = [];
  for (const relative of artifacts)
    built.push({
      path: relative,
      sha256: await retainBlob(
        store,
        new Uint8Array(
          await Bun.file(path.join(repoRoot, relative)).arrayBuffer(),
        ),
      ),
    });
  const dependencies = [];
  for (const entry of [
    { path: paperJarName, pin: paper },
    ...[worldEdit, citizens, coreProtect, luckPerms, multiverseCore].map(
      (pin) => ({ path: `plugins/${pin.name}-${pin.version}.jar`, pin }),
    ),
  ]) {
    const file = path.join(CACHE_DIR, entry.path);
    await mkdir(path.dirname(file), { recursive: true });
    await ensureArtifact(file, entry.pin);
    dependencies.push({
      path: entry.path,
      sha256: await retainBlob(
        store,
        new Uint8Array(await Bun.file(file).arrayBuffer()),
      ),
    });
  }
  const runtime = RuntimeSchema.parse({
    schema: 1,
    revision,
    patch,
    files,
    artifacts: built,
    dependencies,
  });
  return retainBlob(store, new TextEncoder().encode(JSON.stringify(runtime)));
}

/** Restore into a detached checkout; never reset or overwrite the user's worktree. */
export async function restoreRuntime(
  repoRoot: string,
  store: BlobStore,
  options: { cache: string; runtimeHash: string; destination: string },
): Promise<string> {
  const { cache, runtimeHash, destination } = options;
  const runtime = RuntimeSchema.parse(
    await Bun.file(await cachedBlob(store, cache, runtimeHash)).json(),
  );
  await command([
    "git",
    "-C",
    repoRoot,
    "worktree",
    "add",
    "--detach",
    destination,
    runtime.revision,
  ]);
  const patchFile = await cachedBlob(store, cache, runtime.patch);
  if (Bun.file(patchFile).size > 0)
    await command(["git", "-C", destination, "apply", "--binary", patchFile]);
  for (const file of [...runtime.files, ...runtime.artifacts]) {
    const target = path.join(destination, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await Bun.write(
      target,
      Bun.file(await cachedBlob(store, cache, file.sha256)),
    );
  }
  await command(["bun", "install", "--frozen-lockfile", "--cwd", destination]);
  await command([
    "bun",
    "run",
    "--cwd",
    path.join(destination, "packages/llm-models"),
    "build",
  ]);
  return destination;
}

/** Seed the recorded daemon cache from immutable blobs before it can download anything. */
export async function restoreDependencies(
  store: BlobStore,
  options: { cache: string; runtimeHash: string; destination: string },
): Promise<void> {
  const runtime = RuntimeSchema.parse(
    await Bun.file(
      await cachedBlob(store, options.cache, options.runtimeHash),
    ).json(),
  );
  for (const file of runtime.dependencies) {
    const target = path.join(options.destination, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await Bun.write(
      target,
      Bun.file(await cachedBlob(store, options.cache, file.sha256)),
    );
  }
}
