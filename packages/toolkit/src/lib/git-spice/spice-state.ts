import { realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { lookupExecutable } from "#lib/passthrough.ts";
import { spawnCapture } from "#lib/spawn-capture.ts";

type EnvMap = Readonly<Record<string, string | undefined>>;

export function gitExecutable(env: EnvMap): string {
  return lookupExecutable("git", env["PATH"], env["HOME"]) ?? "git";
}

const SpiceRepoSchema = z.looseObject({
  trunk: z.string(),
  remote: z.string().optional().default(""),
});
export type SpiceRepoConfig = {
  readonly trunk: string;
  readonly remote: string;
};

export async function readSpiceRepoConfig(
  cwd: string,
  env: EnvMap = Bun.env,
): Promise<SpiceRepoConfig | null> {
  const res = await spawnCapture(
    [gitExecutable(env), "show", "refs/spice/data:repo"],
    { cwd, env },
  );
  if (res.exitCode !== 0) return null;
  try {
    const parsed = SpiceRepoSchema.safeParse(JSON.parse(res.stdout));
    return parsed.success
      ? { trunk: parsed.data.trunk, remote: parsed.data.remote }
      : null;
  } catch {
    return null;
  }
}

const SpicePrRefSchema = z.looseObject({
  number: z.number().int().optional(),
  gqlID: z.string().optional(),
});
const SpiceBranchRawSchema = z.looseObject({
  base: z
    .looseObject({ name: z.string().optional(), hash: z.string().optional() })
    .optional(),
  change: z
    .looseObject({
      github: z.looseObject({ pr: SpicePrRefSchema.optional() }).optional(),
    })
    .optional(),
  merged: z.array(SpicePrRefSchema).nullable().optional(),
});

export type SpiceBranchMetadata = {
  readonly name: string;
  readonly baseName?: string | undefined;
  readonly baseHash?: string | undefined;
  readonly prNumber?: number | undefined;
  readonly prGqlId?: string | undefined;
  readonly mergedPrs: readonly {
    readonly number?: number | undefined;
    readonly gqlId: string;
  }[];
};

function parseLsTreeEntries(
  stdout: string,
): { readonly oid: string; readonly branch: string }[] {
  const entries: { readonly oid: string; readonly branch: string }[] = [];
  for (const record of stdout.split("\0")) {
    const tab = record.indexOf("\t");
    if (tab === -1) continue;
    const oid = record.slice(0, tab).trim().split(/\s+/u)[2];
    const filePath = record.slice(tab + 1);
    if (
      oid !== undefined &&
      filePath.startsWith("branches/") &&
      filePath.length > 9
    ) {
      entries.push({ oid, branch: filePath.slice(9) });
    }
  }
  return entries;
}

function parseCatFileBatch(buffer: Buffer): Buffer[] {
  const blobs: Buffer[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const newline = buffer.indexOf(0x0a, offset);
    if (newline === -1) break;
    const sizeText = buffer
      .subarray(offset, newline)
      .toString("utf8")
      .split(" ")[2];
    const size =
      sizeText === undefined ? Number.NaN : Number.parseInt(sizeText, 10);
    if (!Number.isInteger(size) || size < 0) break;
    const start = newline + 1;
    const end = start + size;
    if (end > buffer.length) break;
    blobs.push(buffer.subarray(start, end));
    offset = end + 1;
  }
  return blobs;
}

function decodeSpiceBranchBlob(
  branchName: string,
  blob: Buffer,
): SpiceBranchMetadata | null {
  try {
    const parsed = SpiceBranchRawSchema.safeParse(
      JSON.parse(blob.toString("utf8")),
    );
    if (!parsed.success) return null;
    const pr = parsed.data.change?.github?.pr;
    const mergedPrs = (parsed.data.merged ?? []).flatMap((item) =>
      item.gqlID === undefined
        ? []
        : [{ gqlId: item.gqlID, number: item.number }],
    );
    return {
      name: branchName,
      baseName: parsed.data.base?.name,
      baseHash: parsed.data.base?.hash,
      prNumber: pr?.number,
      prGqlId: pr?.gqlID,
      mergedPrs,
    };
  } catch {
    return null;
  }
}

export async function readSpiceBranches(
  cwd: string,
  env: EnvMap = Bun.env,
): Promise<ReadonlyMap<string, SpiceBranchMetadata>> {
  const git = gitExecutable(env);
  const tree = await spawnCapture(
    [git, "ls-tree", "-r", "-z", "refs/spice/data", "--", "branches"],
    { cwd, env },
  );
  if (tree.exitCode !== 0 || tree.stdout.length === 0) return new Map();
  const entries = parseLsTreeEntries(tree.stdout);
  if (entries.length === 0) return new Map();

  const child = Bun.spawn([git, "cat-file", "--batch"], {
    cwd,
    env: { ...env },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  await child.stdin.write(`${entries.map((entry) => entry.oid).join("\n")}\n`);
  await child.stdin.end();
  const [rawStdout, exitCode] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    child.exited,
  ]);
  if (exitCode !== 0) return new Map();

  const blobs = parseCatFileBatch(Buffer.from(rawStdout));
  const branches = new Map<string, SpiceBranchMetadata>();
  for (const [index, entry] of entries.entries()) {
    const blob = blobs[index];
    const decoded =
      blob === undefined ? null : decodeSpiceBranchBlob(entry.branch, blob);
    if (decoded !== null) branches.set(entry.branch, decoded);
  }
  return branches;
}

export type SpiceMissingPrMatch = {
  readonly gqlId: string;
  readonly branch?: string | undefined;
  readonly prNumber?: number | undefined;
};

export async function findBranchesByPrGqlIds(
  cwd: string,
  gqlIds: Iterable<string>,
  env: EnvMap = Bun.env,
): Promise<readonly SpiceMissingPrMatch[]> {
  const targets = [...new Set(gqlIds)];
  if (targets.length === 0) return [];
  const branches = await readSpiceBranches(cwd, env);
  const byActive = new Map<string, SpiceMissingPrMatch>();
  const byMerged = new Map<string, SpiceMissingPrMatch>();
  for (const meta of branches.values()) {
    if (meta.prGqlId !== undefined) {
      byActive.set(meta.prGqlId, {
        gqlId: meta.prGqlId,
        branch: meta.name,
        prNumber: meta.prNumber,
      });
    }
    for (const merged of meta.mergedPrs) {
      if (!byMerged.has(merged.gqlId)) {
        byMerged.set(merged.gqlId, {
          gqlId: merged.gqlId,
          branch: meta.name,
          prNumber: merged.number,
        });
      }
    }
  }
  return targets.map(
    (gqlId) => byActive.get(gqlId) ?? byMerged.get(gqlId) ?? { gqlId },
  );
}

const SpiceRebaseContinueSchema = z.looseObject({
  continuations: z
    .array(
      z.looseObject({
        command: z.array(z.string()).optional().default([]),
        branch: z.string(),
      }),
    )
    .nullable()
    .optional(),
});
export type SpiceContinuation = {
  readonly command: readonly string[];
  readonly branch: string;
};

export async function readSpiceRebaseContinue(
  cwd: string,
  env: EnvMap = Bun.env,
): Promise<readonly SpiceContinuation[]> {
  const res = await spawnCapture(
    [gitExecutable(env), "show", "refs/spice/data:rebase-continue"],
    { cwd, env },
  );
  if (res.exitCode !== 0) return [];
  try {
    const parsed = SpiceRebaseContinueSchema.safeParse(JSON.parse(res.stdout));
    return parsed.success && parsed.data.continuations != null
      ? parsed.data.continuations
      : [];
  } catch {
    return [];
  }
}

export type WorktreeEntry = {
  readonly path: string;
  readonly realPath: string;
  readonly head?: string | undefined;
  readonly branch?: string | undefined;
};

async function safeRealpath(targetPath: string): Promise<string> {
  try {
    return await realpath(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

async function parseWorktreeBlock(
  block: string,
): Promise<WorktreeEntry | null> {
  let wtPath: string | undefined;
  let head: string | undefined;
  let branch: string | undefined;
  for (const line of block.split("\n")) {
    if (line.startsWith("worktree ")) wtPath = line.slice(9).trim();
    else if (line.startsWith("HEAD ")) head = line.slice(5).trim();
    else if (line.startsWith("branch ")) {
      const ref = line.slice(7).trim();
      branch = ref.startsWith("refs/heads/") ? ref.slice(11) : ref;
    }
  }
  return wtPath !== undefined && wtPath.length > 0
    ? { path: wtPath, realPath: await safeRealpath(wtPath), head, branch }
    : null;
}

export async function listWorktrees(
  cwd: string,
  env: EnvMap = Bun.env,
): Promise<readonly WorktreeEntry[]> {
  const res = await spawnCapture(
    [gitExecutable(env), "worktree", "list", "--porcelain"],
    { cwd, env },
  );
  if (res.exitCode !== 0) return [];
  const entries = await Promise.all(
    res.stdout
      .trim()
      .split(/\n{2,}/u)
      .map((b) => parseWorktreeBlock(b)),
  );
  return entries.filter((entry) => entry !== null);
}

export async function readGitConfig(
  cwd: string,
  key: string,
  env: EnvMap = Bun.env,
): Promise<string | null> {
  const res = await spawnCapture([gitExecutable(env), "config", "--get", key], {
    cwd,
    env,
  });
  const trimmed = res.exitCode === 0 ? res.stdout.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

export async function resolveGitDir(
  cwd: string,
  env: EnvMap = Bun.env,
): Promise<string | null> {
  const res = await spawnCapture(
    [gitExecutable(env), "rev-parse", "--git-dir"],
    { cwd, env },
  );
  const raw = res.exitCode === 0 ? res.stdout.trim() : "";
  return raw.length > 0 ? path.resolve(cwd, raw) : null;
}

export async function resolveGitToplevel(
  cwd: string,
  env: EnvMap = Bun.env,
): Promise<string | null> {
  const res = await spawnCapture(
    [gitExecutable(env), "rev-parse", "--show-toplevel"],
    { cwd, env },
  );
  const raw = res.exitCode === 0 ? res.stdout.trim() : "";
  return raw.length > 0 ? safeRealpath(raw) : null;
}
