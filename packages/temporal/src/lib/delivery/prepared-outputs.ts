import { createHash } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/**
 * A stage workspace's checkout, binary directory and kept prepared outputs.
 * A Job mounts its claim at `/workspace` (STAGE_WORKSPACE).
 */
export type PreparedWorkspace = {
  source: string;
  bin: string;
  prepared: string;
};

export const STAGE_WORKSPACE: PreparedWorkspace = {
  source: "/workspace/source",
  bin: "/workspace/bin",
  prepared: "/workspace/prepared",
};

/** The files the full install prepares outside Git: generated code, builds and the toolkit. */
const BINARIES: readonly string[] = ["toolkit"];

/**
 * A kept path is `bin/<binary>` or an untracked checkout file `source/...`
 * outside any repository metadata and installed packages: keeping never lists
 * `.git` or `node_modules` (`ls-files --others --exclude=node_modules`), so a
 * manifest naming one was not written by keepPreparedOutputs.
 */
function keepablePath(value: string) {
  const [top, ...rest] = value.split("/");
  if (path.posix.normalize(value) !== value || rest.length === 0) return false;
  return top === "bin"
    ? rest.length === 1 && BINARIES.includes(rest[0] ?? "")
    : top === "source" &&
        rest.every(
          (segment) =>
            !["", ".", "..", "node_modules"].includes(segment) &&
            segment.toLowerCase() !== ".git",
        );
}

const Sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const KeptPath = z
  .string()
  .refine(
    keepablePath,
    "Kept output path must be a kept binary or a checkout file outside .git and node_modules",
  );
const ManifestSchema = z
  .object({
    key: Sha256,
    files: z.array(z.object({ path: KeptPath, sha256: Sha256 }).strict()),
  })
  .strict();
type Manifest = z.infer<typeof ManifestSchema>;

export type RestoreResult =
  | { restored: true; files: number }
  | { restored: false; reason: "absent" | "other-inputs" }
  | { restored: false; reason: "changed"; detail: string };

export type KeepResult =
  { kept: true; files: number } | { kept: false; detail: string };

/** Whether a filesystem error says the path does not exist. */
function missing(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function sha256(file: string) {
  return createHash("sha256")
    .update(new Uint8Array(await Bun.file(file).arrayBuffer()))
    .digest("hex");
}

/** Every non-directory entry under `root/<top>`, as `<top>/...` paths; null if any is not a regular file. */
async function regularFiles(root: string, tops: readonly string[]) {
  const files: string[] = [];
  for (const top of tops) {
    const base = path.join(root, top);
    const entries = await readdir(base, {
      recursive: true,
      withFileTypes: true,
    }).catch((error: unknown) => {
      if (missing(error)) return [];
      throw error;
    });
    for (const entry of entries) {
      if (entry.isDirectory()) continue;
      if (!entry.isFile()) return null;
      files.push(
        path.posix.join(
          top,
          path.relative(base, path.join(entry.parentPath, entry.name)),
        ),
      );
    }
  }
  return files.sort();
}

async function readManifest(prepared: string): Promise<Manifest | null> {
  const file = Bun.file(path.join(prepared, "manifest.json"));
  if (!(await file.exists())) return null;
  const parsed = ManifestSchema.safeParse(
    await file.json().catch((): unknown => null),
  );
  return parsed.success ? parsed.data : null;
}

/** Where a kept file goes back: `source/x` into the checkout, `bin/x` into the binary directory. */
function destination(workspace: PreparedWorkspace, kept: string) {
  const [top, ...rest] = kept.split("/");
  return path.join(top === "bin" ? workspace.bin : workspace.source, ...rest);
}

/**
 * Restore the outputs a previous Job prepared from the same inputs, as hard
 * links, or report why not. Restoring requires the kept manifest's key to
 * equal `key`, the kept files to be exactly the manifest's (regular files, no
 * additions or removals), every file's sha256 to match and no kept path to be
 * or lie under a tracked path of the checkout. Nothing is linked unless all of
 * that holds. The bootstrap then checks the tracked tree is still clean.
 */
export async function restorePreparedOutputs(
  workspace: PreparedWorkspace,
  key: string,
): Promise<RestoreResult> {
  const manifest = await readManifest(workspace.prepared);
  if (manifest === null) return { restored: false, reason: "absent" };
  if (manifest.key !== key) return { restored: false, reason: "other-inputs" };
  const present = await regularFiles(workspace.prepared, ["source", "bin"]);
  const expected = manifest.files.map((file) => file.path).sort();
  if (present === null)
    return {
      restored: false,
      reason: "changed",
      detail: "a kept output is not a regular file",
    };
  if (present.join("\n") !== expected.join("\n"))
    return {
      restored: false,
      reason: "changed",
      detail: "kept outputs were added or removed",
    };
  for (const file of manifest.files)
    if (
      (await sha256(path.join(workspace.prepared, file.path))) !== file.sha256
    )
      return { restored: false, reason: "changed", detail: file.path };
  const conflict = await trackedConflict(
    workspace,
    manifest.files.map((file) => file.path),
  );
  if (conflict !== undefined)
    return {
      restored: false,
      reason: "changed",
      detail: `${conflict} is or lies under a tracked path`,
    };
  for (const file of manifest.files) {
    const target = destination(workspace, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await unlink(target).catch((error: unknown) => {
      if (!missing(error)) throw error;
    });
    await link(path.join(workspace.prepared, file.path), target);
  }
  return { restored: true, files: manifest.files.length };
}

/**
 * The first kept `source/...` path that is a tracked file or directory of the
 * checkout, or lies under a tracked file or symlink. Linking it would replace
 * tracked content, or write through a tracked symlink, behind the clean-tree
 * check the bootstrap made before restoring.
 */
async function trackedConflict(
  workspace: PreparedWorkspace,
  kept: readonly string[],
) {
  const listed = await git(workspace.source, ["ls-files", "-z"]);
  const tracked = new Set(listed.split("\0").filter((entry) => entry !== ""));
  const directories = new Set<string>();
  for (const file of tracked)
    for (
      let end = file.indexOf("/");
      end !== -1;
      end = file.indexOf("/", end + 1)
    )
      directories.add(file.slice(0, end));
  return kept.find((file) => {
    const [top, ...rest] = file.split("/");
    if (top !== "source") return false;
    const relative = rest.join("/");
    return (
      tracked.has(relative) ||
      directories.has(relative) ||
      rest.some((_, index) => tracked.has(rest.slice(0, index).join("/")))
    );
  });
}

async function git(cwd: string, args: readonly string[]) {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  if (exitCode !== 0)
    throw new Error(`git ${args[0] ?? ""} failed in the stage checkout`);
  return stdout;
}

/**
 * Keep hard links to everything the full install just prepared, with a
 * manifest of each file's sha256 under `key`. Only regular files are kept,
 * and nothing is kept if preparation changed a tracked file, because a later
 * restore could not reproduce that change. The manifest is written last.
 */
export async function keepPreparedOutputs(
  workspace: PreparedWorkspace,
  key: string,
): Promise<KeepResult> {
  Sha256.parse(key);
  await rm(workspace.prepared, { recursive: true, force: true });
  const result = await linkPreparedOutputs(workspace, key);
  if (!result.kept)
    await rm(workspace.prepared, { recursive: true, force: true });
  return result;
}

async function linkPreparedOutputs(
  workspace: PreparedWorkspace,
  key: string,
): Promise<KeepResult> {
  const tracked = await git(workspace.source, [
    "status",
    "--porcelain=v1",
    "--untracked-files=no",
  ]);
  if (tracked.trim() !== "")
    return { kept: false, detail: "preparation changed tracked files" };
  const listed = await git(workspace.source, [
    "ls-files",
    "-z",
    "--others",
    "--exclude=node_modules",
  ]);
  const untracked = listed.split("\0").filter((entry) => entry !== "");
  const kept = [
    ...untracked.map((file) => ({
      from: path.join(workspace.source, file),
      path: path.posix.join("source", file),
    })),
    ...BINARIES.map((name) => ({
      from: path.join(workspace.bin, name),
      path: path.posix.join("bin", name),
    })),
  ];
  const files: Manifest["files"] = [];
  for (const file of kept) {
    if (!KeptPath.safeParse(file.path).success)
      return { kept: false, detail: `unkeepable path ${file.path}` };
    const info = await lstat(file.from);
    if (!info.isFile())
      return { kept: false, detail: `${file.path} is not a regular file` };
    const target = path.join(workspace.prepared, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await link(file.from, target);
    files.push({ path: file.path, sha256: await sha256(target) });
  }
  const manifest = path.join(workspace.prepared, "manifest.json");
  await writeFile(`${manifest}.tmp`, JSON.stringify({ key, files }));
  await rename(`${manifest}.tmp`, manifest);
  return { kept: true, files: files.length };
}
