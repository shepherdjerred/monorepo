import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";

export const DEFAULT_INSTANCE = "default";

/** Non-secret bootstrap routing. Absence derives a worktree-scoped instance inside Git repos. */
const InstanceSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,31}$/u)
    .optional(),
);

const repoRootCache = new Map<string, string | null>();
const canonicalPathCache = new Map<string, string>();

function canonicalizePath(target: string): string {
  const resolved = path.resolve(target);
  const cached = canonicalPathCache.get(resolved);
  if (cached !== undefined) {
    return cached;
  }
  const result = Bun.spawnSync(["realpath", resolved], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const canonical =
    result.exitCode === 0 ? result.stdout.toString().trim() : resolved;
  const finalPath = canonical.length > 0 ? canonical : resolved;
  canonicalPathCache.set(resolved, finalPath);
  return finalPath;
}

/** Locates the canonical enclosing Git repository or linked worktree root from `startDir`. */
export function findRepoRoot(startDir: string = process.cwd()): string | null {
  const resolved = path.resolve(startDir);
  if (repoRootCache.has(resolved)) {
    return repoRootCache.get(resolved) ?? null;
  }
  const result = Bun.spawnSync(
    ["git", "-C", resolved, "rev-parse", "--show-toplevel"],
    {
      stdout: "pipe",
      stderr: "ignore",
    },
  );
  if (result.exitCode !== 0) {
    repoRootCache.set(resolved, null);
    return null;
  }
  const rawRoot = result.stdout.toString().trim();
  if (rawRoot.length === 0) {
    repoRootCache.set(resolved, null);
    return null;
  }
  const canonical = canonicalizePath(rawRoot);
  repoRootCache.set(resolved, canonical);
  return canonical;
}

/** Deterministic `wt-<slug>-<sha256_6>` instance key (<=32 chars) for a canonical repo/worktree root. */
export function worktreeInstance(repoRoot: string): string {
  const canonical = canonicalizePath(repoRoot);
  const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 6);
  const slug = path
    .basename(canonical)
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, 22)
    .replaceAll(/-+$/gu, "");
  return slug.length > 0 ? `wt-${slug}-${hash}` : `wt-${hash}`;
}

export function resolveInstance(options?: {
  instanceEnv?: unknown;
  directoryEnv?: unknown;
  cwd?: string;
}): string {
  const explicit = InstanceSchema.parse(options?.instanceEnv);
  if (explicit !== undefined) {
    return explicit;
  }
  if (
    typeof options?.directoryEnv === "string" &&
    options.directoryEnv.length > 0
  ) {
    return DEFAULT_INSTANCE;
  }
  const repoRoot = findRepoRoot(options?.cwd ?? process.cwd());
  return repoRoot === null ? DEFAULT_INSTANCE : worktreeInstance(repoRoot);
}

export function currentInstance(cwd: string = process.cwd()): string {
  return resolveInstance({
    instanceEnv: Bun.env["TOOLKIT_MC_INSTANCE"],
    directoryEnv: Bun.env["TOOLKIT_MC_DIRECTORY"],
    cwd,
  });
}

export function instanceDirectory(base: string, instance: unknown): string {
  const name = InstanceSchema.parse(instance);
  return name === undefined || name === DEFAULT_INSTANCE
    ? base
    : path.join(base, "instances", name);
}

export function instanceOwner(owner: string, instance: unknown): string {
  const name = InstanceSchema.parse(instance);
  return name === undefined || name === DEFAULT_INSTANCE
    ? owner
    : `${owner}:${name}`;
}
