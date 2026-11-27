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
const BINARIES = ["toolkit"] as const;

const Sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const KeptPath = z
  .string()
  .refine(
    (value) =>
      /^(?:source|bin)\/./u.test(value) &&
      path.posix.normalize(value) === value &&
      !value.split("/").includes(".."),
    "Kept output path must stay inside the prepared directory",
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
 * additions or removals) and every file's sha256 to match. Nothing is linked
 * unless all of that holds.
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
