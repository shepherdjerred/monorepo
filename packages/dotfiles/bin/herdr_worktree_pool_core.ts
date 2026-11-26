import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  fields,
  shareWithMainCheckout,
  slug,
  type Toolkit,
} from "./herdr_new_worktree_core.ts";

const capacity = 3;
const originMain = "refs/remotes/origin/main";
const slotName = /^slot-[a-f0-9-]{36}$/;
const lockReason = "Herdr worktree pool";

export type PoolLocation = { readonly repo: string; readonly root: string };
export type Allocation = PoolLocation & {
  readonly branch: string;
  readonly generated: boolean;
};

type Result = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};
type Slot = {
  readonly name: string;
  readonly admin: string;
  readonly target: string | null;
};

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

export function samePath(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

async function git(cwd: string, args: readonly string[]): Promise<Result> {
  // Staged paths add a pool and slot prefix before repository filenames.
  const longPaths =
    process.platform === "win32" ? ["-c", "core.longpaths=true"] : [];
  const child = Bun.spawn(
    [
      "git",
      "--no-optional-locks",
      "-c",
      "submodule.recurse=false",
      ...longPaths,
      ...args,
    ],
    {
      cwd,
      env: { ...Bun.env, GIT_TERMINAL_PROMPT: "0" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 240_000,
    },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

function checked(result: Result, action: string): string {
  if (result.code !== 0) {
    const lines = result.stderr.trim().split("\n");
    const line =
      lines.find(
        (entry) => entry.startsWith("error:") || entry.startsWith("fatal:"),
      ) ?? lines.at(-1);
    throw new Error(
      line === undefined || line === ""
        ? `${action} failed (git exit ${String(result.code)})`
        : `${action}: ${line}`,
    );
  }
  return result.stdout.trim();
}

async function fetchMain(repo: string): Promise<string> {
  const result = await git(repo, [
    "fetch",
    "--no-tags",
    "origin",
    `+refs/heads/main:${originMain}`,
  ]);
  // Remote error output can include the configured URL. Keep it out of events.
  if (result.code !== 0)
    throw new Error(
      `Could not fetch origin/main on the target host (git exit ${String(result.code)}).`,
    );
  return checked(
    await git(repo, ["rev-parse", "--verify", `${originMain}^{commit}`]),
    "Resolve origin/main",
  );
}

async function locked<T>(file: string, action: () => Promise<T>): Promise<T> {
  const db = new Database(file);
  try {
    const end = Date.now() + 300_000;
    for (;;) {
      try {
        db.run("BEGIN IMMEDIATE");
        break;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          error.code !== "SQLITE_BUSY" ||
          Date.now() >= end
        )
          throw error;
        await Bun.sleep(200);
      }
    }
    try {
      return await action();
    } finally {
      db.run("ROLLBACK");
    }
  } finally {
    db.close();
  }
}

async function knownWorktrees(repo: string): Promise<string[]> {
  const result = await git(repo, ["worktree", "list", "--porcelain", "-z"]);
  checked(result, "List worktrees");
  return result.stdout
    .split("\0")
    .flatMap((entry) =>
      entry.startsWith("worktree ") ? [entry.slice(9)] : [],
    );
}

async function branchExists(repo: string, branch: string): Promise<boolean> {
  const result = await git(repo, [
    "show-ref",
    "--verify",
    "--quiet",
    `refs/heads/${branch}`,
  ]);
  if (result.code === 1) return false;
  checked(result, "Check branch");
  return true;
}

async function directoryFor(repo: string, root: string): Promise<string> {
  const common = checked(
    await git(repo, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]),
    "Find Git common directory",
  );
  const key = createHash("sha256")
    .update(process.platform === "win32" ? common.toLowerCase() : common)
    .digest("hex")
    .slice(0, 16);
  const directory = path.join(path.dirname(root), ".pool", key);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return directory;
}

async function adminAt(cwd: string): Promise<string | null> {
  if (!(await exists(path.join(cwd, ".git")))) return null;
  const result = await git(cwd, [
    "rev-parse",
    "--path-format=absolute",
    "--git-dir",
  ]);
  return result.code === 0 ? result.stdout.trim() : null;
}

async function cleanDetached(cwd: string, admin: string): Promise<boolean> {
  const actual = await adminAt(cwd);
  if (actual === null || !samePath(admin, actual)) return false;
  const branch = await git(cwd, ["symbolic-ref", "--quiet", "HEAD"]);
  if (branch.code !== 1) return false;
  const commit = await git(cwd, ["rev-parse", "--verify", "HEAD^{commit}"]);
  if (commit.code !== 0) return false;
  const status = await git(cwd, [
    "-c",
    "core.fsmonitor=false",
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--ignored=matching",
  ]);
  return status.code === 0 && status.stdout === "";
}

async function poolLock(
  repo: string,
  cwd: string,
  admin: string,
  owned = true,
): Promise<boolean> {
  try {
    const reason = await readFile(path.join(admin, "locked"), "utf8");
    return reason.trim() === lockReason;
  } catch (error) {
    if (!missing(error)) throw error;
  }
  if (!owned) return false;
  checked(
    await git(repo, ["worktree", "lock", "--reason", lockReason, "--", cwd]),
    "Protect staged worktree",
  );
  return true;
}

async function writeSlot(directory: string, slot: Slot): Promise<void> {
  const pathToSlot = path.join(directory, `${slot.name}.json`);
  const temporary = path.join(directory, `${slot.name}-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(slot), { mode: 0o600 });
  await rename(temporary, pathToSlot);
}

async function readSlots(directory: string): Promise<Slot[]> {
  const slots: Slot[] = [];
  const files = await readdir(directory);
  for (const file of files.sort()) {
    if (path.extname(file) !== ".json") continue;
    const name = path.basename(file, ".json");
    if (!slotName.test(name)) continue;
    const value = fields(
      JSON.parse(await readFile(path.join(directory, file), "utf8")),
      "Pool slot",
    );
    const admin = value.get("admin");
    const target = value.get("target");
    if (
      typeof admin !== "string" ||
      (target !== null && typeof target !== "string") ||
      value.get("name") !== name
    )
      throw new TypeError(`Invalid worktree pool slot ${name}.`);
    slots.push({ name, admin, target });
  }
  return slots;
}

/** Recover interrupted moves only when the Git registration still proves ownership. */
async function restoreClaim(
  location: PoolLocation,
  worktrees: readonly string[],
  from: string,
  claim: { readonly target: string; readonly admin: string },
): Promise<boolean> {
  const { target, admin } = claim;
  if (
    !samePath(path.dirname(target), location.root) ||
    !worktrees.some((entry) => samePath(entry, target)) ||
    (await exists(from)) ||
    !(await cleanDetached(target, admin))
  )
    return false;
  const restored = await git(location.repo, [
    "worktree",
    "move",
    "--",
    target,
    from,
  ]);
  return restored.code === 0 && (await cleanDetached(from, admin));
}

async function readySlots(
  repo: string,
  root: string,
  directory: string,
  limit = Number.POSITIVE_INFINITY,
): Promise<Slot[]> {
  const ready: Slot[] = [];
  const worktrees = await knownWorktrees(repo);
  const registered = (candidate: string) =>
    worktrees.some((entry) => samePath(entry, candidate));
  for (const slot of await readSlots(directory)) {
    const from = path.join(directory, slot.name);
    let owned = registered(from) && (await cleanDetached(from, slot.admin));
    if (slot.target !== null) {
      // An attached, dirty or ambiguous target is preserved at its current path.
      owned ||= await restoreClaim({ repo, root }, worktrees, from, {
        target: slot.target,
        admin: slot.admin,
      });
      if (!owned) continue;
      await writeSlot(directory, { ...slot, target: null });
    }
    if (owned && (await poolLock(repo, from, slot.admin))) {
      ready.push(slot);
      if (ready.length >= limit) break;
    }
  }
  return ready;
}

/**
 * Fill the pool to its capacity. With a `toolkit`, each slot made here starts
 * sharing its unchanged files with the main checkout in the background; a
 * claim repeats that for the checkout the slot becomes, whose path differs.
 */
export async function replenish(
  location: PoolLocation,
  refresh: boolean,
  toolkit?: Toolkit,
): Promise<number> {
  await mkdir(location.root, { recursive: true });
  const [repo, root] = await Promise.all([
    realpath(location.repo),
    realpath(location.root),
  ]);
  if (refresh && process.platform === "win32") {
    // Claimed checkouts also need ordinary agent Git commands to work on
    // long paths. Linked worktrees share the main repository's local config.
    checked(
      await git(repo, ["config", "--local", "core.longpaths", "true"]),
      "Enable long paths for the Windows monorepo",
    );
  }
  const directory = await directoryFor(repo, root);
  const claimLock = path.join(directory, "claim.sqlite");
  return locked(path.join(directory, "refill.sqlite"), async () => {
    let count = await locked(claimLock, async () => {
      const slots = await readSlots(directory);
      const recorded = new Set(slots.map((slot) => slot.name));
      for (const candidate of await knownWorktrees(repo)) {
        const name = path.basename(candidate);
        if (
          !samePath(path.dirname(candidate), directory) ||
          !slotName.test(name) ||
          recorded.has(name)
        )
          continue;
        const admin = await adminAt(candidate);
        if (
          admin !== null &&
          (await cleanDetached(candidate, admin)) &&
          (await poolLock(repo, candidate, admin, false))
        )
          await writeSlot(directory, { name, admin, target: null });
      }
      const ready = await readySlots(repo, root, directory);
      return ready.length;
    });
    if (count >= capacity) return count;
    const tip = refresh
      ? await locked(claimLock, async () => fetchMain(repo))
      : checked(
          await git(repo, ["rev-parse", "--verify", `${originMain}^{commit}`]),
          "Resolve origin/main",
        );
    for (
      let prepared = 0;
      count < capacity && prepared < capacity;
      prepared++
    ) {
      const name = `slot-${randomUUID()}`;
      const candidate = path.join(directory, name);
      checked(
        await git(repo, [
          "worktree",
          "add",
          "--detach",
          "--lock",
          "--reason",
          lockReason,
          "--",
          candidate,
          tip,
        ]),
        "Prepare worktree pool slot",
      );
      const admin = await adminAt(candidate);
      if (admin === null || !(await cleanDetached(candidate, admin)))
        throw new Error(
          `Prepared worktree ${name} did not verify as clean and detached.`,
        );
      count = await locked(claimLock, async () => {
        await writeSlot(directory, { name, admin, target: null });
        const ready = await readySlots(repo, root, directory);
        if (!ready.some((slot) => slot.name === name))
          throw new Error(
            `Prepared worktree ${name} was not ready after publishing.`,
          );
        return ready.length;
      });
      await shareWithMainCheckout(toolkit, candidate);
    }
    return count;
  });
}

async function chooseCheckout(
  input: Allocation,
): Promise<{ branch: string; target: string; existing: boolean }> {
  const { repo, root } = input;
  const worktrees = await knownWorktrees(repo);
  let branch = input.branch;
  for (let attempt = 1; attempt <= 99; attempt++) {
    const verified = checked(
      await git(repo, ["check-ref-format", "--branch", branch]),
      "Invalid worktree branch",
    );
    if (verified !== branch)
      throw new Error("Use a literal worktree branch name.");
    const folder = slug(branch);
    if (folder === "" || folder === "." || folder === "..")
      throw new Error("Branch has no usable worktree folder name.");
    const target = path.join(root, folder);
    const existing = await branchExists(repo, branch);
    const occupied =
      worktrees.some((entry) => samePath(entry, target)) ||
      (await exists(target));
    if (!occupied && !(existing && input.generated))
      return { branch, target, existing };
    if (!input.generated)
      throw new Error(`Worktree path already exists: ${target}`);
    const suffix = `-${String(attempt + 1)}`;
    branch = `${input.branch.slice(0, 40 - suffix.length).replace(/[./-]+$/, "")}${suffix}`;
  }
  throw new Error(`Every generated name for ${input.branch} is taken.`);
}

/**
 * Allocate on this computer, which owns the worktree even when the worker
 * reached it through `hc exec`, and start the final-path dedupe here.
 */
export async function allocate(
  input: Allocation,
  pooled: boolean,
  toolkit?: Toolkit,
) {
  await mkdir(input.root, { recursive: true });
  const [repo, root] = await Promise.all([
    realpath(input.repo),
    realpath(input.root),
  ]);
  const directory = await directoryFor(repo, root);
  const checkout = await locked(path.join(directory, "claim.sqlite"), async () => {
    const { branch, target, existing } = await chooseCheckout({
      ...input,
      repo,
      root,
    });
    if (existing) {
      checked(
        await git(repo, ["worktree", "add", "--", target, branch]),
        "Open existing branch",
      );
      return { branch, path: target };
    }
    const tip = await fetchMain(repo);
    const [slot] = pooled ? await readySlots(repo, root, directory, 1) : [];
    if (slot === undefined) {
      checked(
        await git(repo, ["worktree", "add", "-b", branch, "--", target, tip]),
        "Create worktree from origin/main",
      );
    } else {
      await writeSlot(directory, { ...slot, target });
      const from = path.join(directory, slot.name);
      checked(
        await git(repo, ["worktree", "unlock", "--", from]),
        "Release staged worktree protection",
      );
      checked(
        await git(repo, ["worktree", "move", "--", from, target]),
        "Claim staged worktree",
      );
      checked(
        await git(target, ["switch", "-c", branch, tip]),
        "Start branch at origin/main",
      );
      await rm(path.join(directory, `${slot.name}.json`));
    }
    return { branch, path: target };
  });
  const dedupe = await shareWithMainCheckout(toolkit, checkout.path);
  return { ...checkout, dedupe };
}
