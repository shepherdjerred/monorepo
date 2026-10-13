import {
  lstat,
  cp,
  mkdir,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  statfs,
  utimes,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { CommitSchema, git, verifyObjects } from "./git.ts";
import { cloneTree } from "./snapshot.ts";

export const SEED_ROOT = "/woodpecker/workspace-seeds";
export const SeedProfileSchema = z.enum(["verify", "browser"]);
export const SeedResultSchema = z.object({
  status: z.enum(["completed", "deferred"]),
});
export const SeedManifestSchema = z.object({
  version: z.literal(1),
  repository: z.literal("https://github.com/shepherdjerred/monorepo.git"),
  profile: SeedProfileSchema,
  sourceSha: CommitSchema,
  tree: CommitSchema,
  fingerprint: z.string().regex(/^[a-f\d]{64}$/u),
  image: z.string().regex(/@sha256:[a-f\d]{64}$/u),
});
export type SeedManifest = z.infer<typeof SeedManifestSchema>;

/** Git blob IDs cover dependency inputs before a worktree exists. */
export async function seedFingerprint(
  workspace: string,
  commit: string,
  profile: SeedManifest["profile"],
  image: string,
) {
  const tree = await git(workspace, [
    "ls-tree",
    "-r",
    "--full-tree",
    CommitSchema.parse(commit),
  ]);
  const inputs = tree.split("\n").filter((entry) => {
    const name = entry.split("\t")[1];
    return (
      name !== undefined &&
      (name.endsWith("/package.json") ||
        /(?:^|\/)(?:build|settings)\.gradle(?:\.kts)?$/u.test(name) ||
        /(?:^|\/)gradle\.(?:properties|lockfile)$/u.test(name) ||
        name.includes("/gradle/") ||
        [
          "package.json",
          "bun.lock",
          "bunfig.toml",
          ".mise.toml",
          "mise.lock",
          "ci/scripts/publish-workspace-seed.ts",
          "ci/scripts/bun-install.sh",
          "ci/scripts/selection/playwright-targets.ts",
          "ci/scripts/selectors/select-image-targets-workspaces.ts",
          "packages/woodpecker-config-extension/src/checkout/prepared.ts",
        ].includes(name) ||
        name.startsWith("patches/") ||
        name.includes("/patches/"))
    );
  });
  return new Bun.CryptoHasher("sha256")
    .update(
      `prepared-workspace/v1\0${profile}\0${image}\0${process.platform}\0${process.arch}\0${inputs.join("\n")}`,
    )
    .digest("hex");
}

function generation(root: string, manifest: SeedManifest) {
  return path.join(
    root,
    "v1",
    manifest.profile,
    `${manifest.fingerprint}-${manifest.sourceSha}`,
  );
}
function indexFile(
  root: string,
  profile: SeedManifest["profile"],
  fingerprint: string,
) {
  return path.join(root, "indexes", profile, `${fingerprint}.json`);
}

/** Seeds are mounted read-only by native admission; no build pod can publish. */
export async function restorePreparedSeed({
  workspace,
  root,
  commit,
  profile,
  image,
}: {
  workspace: string;
  root: string;
  commit: string;
  profile: SeedManifest["profile"];
  image: string;
}) {
  const fingerprint = await seedFingerprint(workspace, commit, profile, image);
  const index = Bun.file(indexFile(root, profile, fingerprint));
  if (!(await index.exists())) return { hit: false, sourceSha: null };
  const manifest = SeedManifestSchema.parse(await index.json());
  if (
    manifest.fingerprint !== fingerprint ||
    manifest.profile !== profile ||
    manifest.image !== image
  )
    throw new Error("Prepared workspace identity mismatch");
  const source = generation(root, manifest);
  const stored = SeedManifestSchema.parse(
    await Bun.file(path.join(source, "manifest.json")).json(),
  );
  if (JSON.stringify(stored) !== JSON.stringify(manifest))
    throw new Error("Prepared workspace manifest mismatch");
  await cloneTree(
    path.join(source, "objects"),
    path.join(workspace, ".git", "objects"),
  );
  const shallow = path.join(workspace, ".git", "shallow");
  const existing = Bun.file(shallow);
  const existingText = (await existing.exists()) ? await existing.text() : "";
  const seedText = await Bun.file(path.join(source, "shallow")).text();
  const boundaries = [
    ...new Set(
      [
        ...existingText.trim().split("\n"),
        ...seedText.trim().split("\n"),
      ].filter(Boolean),
    ),
  ];
  if (boundaries.length === 0) await rm(shallow, { force: true });
  else await Bun.write(shallow, `${boundaries.join("\n")}\n`);
  if ((await verifyObjects(workspace, manifest.sourceSha)) !== manifest.tree)
    throw new Error("Prepared workspace source tree mismatch");
  // Populate the old tracked set before reset so deleted and renamed paths
  // are removed, and unchanged source files need not be written again.
  await git(workspace, ["read-tree", manifest.sourceSha]);
  await cloneTree(path.join(source, "tree"), workspace);
  await git(workspace, ["update-index", "--refresh"]);
  return { hit: true, sourceSha: manifest.sourceSha };
}

/** Copy the immutable module cache while holding the shared seed lock. */
export async function restoreGradleSeed(
  workspace: string,
  root: string,
  commit: string,
  image: string,
) {
  const fingerprint = await seedFingerprint(workspace, commit, "verify", image);
  const index = Bun.file(indexFile(root, "verify", fingerprint));
  if (!(await index.exists())) return false;
  const manifest = SeedManifestSchema.parse(await index.json());
  if (
    manifest.fingerprint !== fingerprint ||
    manifest.image !== image ||
    manifest.profile !== "verify"
  )
    throw new Error("Gradle seed identity mismatch");
  const source = path.join(generation(root, manifest), "gradle");
  if (!(await Bun.file(path.join(source, "ready.json")).exists())) return false;
  await cloneTree(source, path.join(workspace, ".git", "ci-gradle-seed"));
  return true;
}

async function validateDependencyLinks(
  directory: string,
  workspace: string,
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      if (path.isAbsolute(await readlink(file)))
        throw new Error("Prepared dependency contains an absolute link");
      const target = await realpath(file);
      if (!target.startsWith(`${workspace}/`))
        throw new Error("Prepared dependency escapes the workspace");
    } else if (entry.isDirectory())
      await validateDependencyLinks(file, workspace);
    else if (!entry.isFile())
      throw new Error("Prepared dependency contains an unexpected file type");
  }
}

export async function publishPreparedSeed(
  workspace: string,
  root: string,
  profile: SeedManifest["profile"],
  options: {
    image: string;
    capacity?: () => Promise<{ blocks: number; bfree: number }>;
  },
) {
  const { image } = options;
  const capacity = options.capacity ?? (() => statfs(root));
  const sourceSha = CommitSchema.parse(
    await git(workspace, ["rev-parse", "HEAD"]),
  );
  const tree = CommitSchema.parse(
    await git(workspace, ["rev-parse", "HEAD^{tree}"]),
  );
  if ((await git(workspace, ["write-tree"])) !== tree)
    throw new Error("Prepared seed index differs from its source");
  const manifest = SeedManifestSchema.parse({
    version: 1,
    repository: "https://github.com/shepherdjerred/monorepo.git",
    profile,
    sourceSha,
    tree,
    image,
    fingerprint: await seedFingerprint(workspace, sourceSha, profile, image),
  });
  const destination = generation(root, manifest);
  const index = indexFile(root, profile, manifest.fingerprint);
  if (await Bun.file(path.join(destination, "manifest.json")).exists()) {
    const existing = SeedManifestSchema.parse(
      await Bun.file(path.join(destination, "manifest.json")).json(),
    );
    if (JSON.stringify(existing) !== JSON.stringify(manifest))
      throw new Error("Existing prepared seed identity mismatch");
    const now = new Date();
    await utimes(destination, now, now);
    await publishIndex(index, manifest);
    await collectPreparedSeeds(root, destination);
    return { status: "completed" as const, manifest };
  }
  await mkdir(root, { recursive: true });
  await collectPreparedSeeds(root);
  const initialSpace = await capacity();
  if ((initialSpace.blocks - initialSpace.bfree) / initialSpace.blocks > 0.7)
    return { status: "deferred" as const, manifest };
  const temporary = `${destination}.tmp-${crypto.randomUUID()}`;
  await mkdir(path.join(temporary, "tree"), { recursive: true });
  try {
    await git(workspace, [
      "checkout-index",
      "--all",
      `--prefix=${temporary}/tree/`,
    ]);
    await copyDependencies(workspace, temporary);
    await cloneTree(
      path.join(workspace, ".git", "objects"),
      path.join(temporary, "objects"),
    );
    if (profile === "verify") await copyGradle(temporary, manifest);
    const shallow = Bun.file(path.join(workspace, ".git", "shallow"));
    await Bun.write(
      path.join(temporary, "shallow"),
      (await shallow.exists()) ? await shallow.text() : "",
    );
    await Bun.write(
      path.join(temporary, "manifest.json"),
      JSON.stringify(manifest),
    );
    await collectPreparedSeeds(root, temporary);
    const space = await capacity();
    if ((space.blocks - space.bfree) / space.blocks > 0.7)
      return { status: "deferred" as const, manifest };
    await rename(temporary, destination);
    const now = new Date();
    await utimes(destination, now, now);
    await publishIndex(index, manifest);
    await collectPreparedSeeds(root, destination);
    return { status: "completed" as const, manifest };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function copyDependencies(workspace: string, temporary: string) {
  const tracked = await git(workspace, ["ls-files"]);
  const directories = new Set([
    "node_modules",
    ...tracked
      .split("\n")
      .filter((name) => name.endsWith("/package.json"))
      .map((name) => `${path.dirname(name)}/node_modules`),
  ]);
  for (const directory of directories) {
    const source = path.join(workspace, directory);
    try {
      const info = await lstat(source);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("Prepared dependency root must be a directory");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        continue;
      throw error;
    }
    await validateDependencyLinks(source, await realpath(workspace));
    await cloneTree(source, path.join(temporary, "tree", directory));
  }
}

async function copyGradle(temporary: string, manifest: SeedManifest) {
  const modules = "/woodpecker/gradle/caches/modules-2";
  try {
    await lstat(modules);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return;
    throw error;
  }
  await cp(modules, path.join(temporary, "gradle", "modules-2"), {
    recursive: true,
    filter: (file) =>
      !file.endsWith(".lock") && path.basename(file) !== "gc.properties",
  });
  await Bun.write(
    path.join(temporary, "gradle", "ready.json"),
    JSON.stringify({ image: manifest.image, sourceSha: manifest.sourceSha }),
  );
}

async function publishIndex(index: string, manifest: SeedManifest) {
  await mkdir(path.dirname(index), { recursive: true });
  const temporary = `${index}.tmp-${crypto.randomUUID()}`;
  try {
    await Bun.write(temporary, JSON.stringify(manifest));
    await rename(temporary, index);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Caller holds the exclusive seed lock; keep two generations per profile. */
export async function collectPreparedSeeds(
  root: string,
  activeDirectory?: string,
) {
  for (const profile of SeedProfileSchema.options) {
    const parent = path.join(root, "v1", profile);
    let entries;
    try {
      entries = await readdir(parent, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        continue;
      throw error;
    }
    await collectInterrupted(parent, entries, activeDirectory);
    const generations = await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            /^[a-f\d]{64}-[a-f\d]{40}$/u.test(entry.name),
        )
        .map(async (entry) => {
          const directory = path.join(parent, entry.name);
          const info = await stat(directory);
          return { directory, touched: info.mtimeMs };
        }),
    );
    for (const old of generations
      .toSorted(
        (a, b) =>
          Number(b.directory === activeDirectory) -
            Number(a.directory === activeDirectory) || b.touched - a.touched,
      )
      .slice(2)) {
      const manifest = SeedManifestSchema.parse(
        await Bun.file(path.join(old.directory, "manifest.json")).json(),
      );
      const index = indexFile(root, profile, manifest.fingerprint);
      if (
        (await Bun.file(index).exists()) &&
        SeedManifestSchema.parse(await Bun.file(index).json()).sourceSha ===
          manifest.sourceSha
      )
        await rm(index);
      await rm(old.directory, { recursive: true });
    }
  }
}

async function collectInterrupted(
  parent: string,
  entries: readonly { name: string; isDirectory: () => boolean }[],
  activeDirectory?: string,
) {
  // The exclusive seed lock proves no other publisher is using these paths.
  // Reclaim a killed publisher's partial copy before enforcing capacity.
  for (const entry of entries) {
    const directory = path.join(parent, entry.name);
    if (
      directory !== activeDirectory &&
      entry.isDirectory() &&
      /^[a-f\d]{64}-[a-f\d]{40}\.tmp-[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/u.test(
        entry.name,
      )
    )
      await rm(directory, { recursive: true });
  }
}
