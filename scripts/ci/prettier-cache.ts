import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

/** Configuration and plugin changes invalidate every file-level result. */
export async function prettierCacheKey(root: string): Promise<string> {
  const files = Bun.spawnSync(
    [
      "git",
      "ls-files",
      "-z",
      "--",
      "bun.lock",
      "package.json",
      "**/package.json",
      ".gitignore",
      "**/.gitignore",
      "**/.editorconfig",
      ".editorconfig",
      ".prettier*",
      "**/.prettier*",
      "prettier.config.*",
      "**/prettier.config.*",
      "scripts/ci/run-shard-check.ts",
      "scripts/ci/repo-shards.ts",
      "scripts/ci/prettier-cache.ts",
    ],
    { cwd: root },
  );
  if (files.exitCode !== 0)
    throw new Error("Could not enumerate formatter cache inputs");
  const node = Bun.spawnSync(["node", "-p", "process.version"]);
  if (node.exitCode !== 0) {
    throw new Error("Could not identify formatter Node runtime");
  }
  const hash = new Bun.CryptoHasher("sha256");
  hash.update(
    `prettier-cache/v1\0${Bun.version}\0${node.stdout.toString().trim()}\0`,
  );
  for (const file of files.stdout
    .toString()
    .split("\0")
    .filter(Boolean)
    .sort()) {
    hash.update(file);
    hash.update("\0");
    hash.update(await Bun.file(path.join(root, file)).arrayBuffer());
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** Private readers and atomic last-writer-wins publication avoid lock waits. */
export async function preparePrettierCache(
  root: string,
  sharedRoot: string,
  shard: string,
) {
  if (!path.isAbsolute(sharedRoot) || !/^[a-z-]+$/u.test(shard))
    throw new Error("Invalid formatter cache location");
  const directory = path.join(sharedRoot, "prettier", shard);
  const published = path.join(
    directory,
    `${await prettierCacheKey(root)}.json`,
  );
  const scratch = path.join(root, ".turbo", "prettier");
  await mkdir(directory, { recursive: true });
  await mkdir(scratch, { recursive: true });
  const privateFile = path.join(
    scratch,
    `${shard}-${crypto.randomUUID()}.json`,
  );
  try {
    await cp(published, privateFile);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  return {
    args: [
      "--cache",
      "--cache-strategy",
      "content",
      "--cache-location",
      privateFile,
    ],
    async publish() {
      if (!(await Bun.file(privateFile).exists())) return;
      const temporary = `${published}.tmp-${crypto.randomUUID()}`;
      try {
        await cp(privateFile, temporary);
        await rename(temporary, published);
        await prune(directory, published);
      } finally {
        await rm(temporary, { force: true });
      }
    },
    cleanup: () => rm(privateFile, { force: true }),
  };
}

/** Readers already own private copies, so old configurations need no leases. */
async function prune(directory: string, current: string) {
  const names = await readdir(directory);
  const entries = await Promise.all(
    names
      .filter((name) => /^[a-f\d]{64}\.json$/u.test(name))
      .map(async (name) => {
        const file = path.join(directory, name);
        try {
          const info = await stat(file);
          return { file, modified: info.mtimeMs };
        } catch (error) {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          )
            return { file, modified: 0 };
          throw error;
        }
      }),
  );
  const old = entries
    .filter((entry) => entry.file !== current)
    .toSorted((a, b) => b.modified - a.modified)
    .slice(3);
  await Promise.all(old.map((entry) => rm(entry.file, { force: true })));
}
