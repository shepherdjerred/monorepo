import { stat, statfs } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/**
 * Where a finished CI workspace's bytes went, so the next SSD-write lever is
 * chosen from evidence rather than guessed. Each category is one `du`
 * invocation, which counts a hard-linked file once. Every category shares one
 * deadline so a huge or slow tree cannot stretch the step, and a category that
 * misses it reports null bytes rather than a partial total.
 */
const OUTPUTS = "{dist,build,.turbo,target,.svelte-kit,.next}";
export const WORKSPACE_USAGE_CATEGORIES = [
  { name: "workspace", patterns: ["."] },
  { name: "git", patterns: [".git"] },
  { name: "root-node-modules", patterns: ["node_modules"] },
  {
    name: "package-node-modules",
    patterns: ["packages/*/node_modules", "packages/*/packages/*/node_modules"],
  },
  {
    name: "package-outputs",
    patterns: [`packages/*/${OUTPUTS}`, `packages/*/packages/*/${OUTPUTS}`],
  },
  { name: "root-turbo", patterns: [".turbo"] },
  { name: "woodpecker-tmp", patterns: ["/woodpecker/tmp"] },
  { name: "woodpecker-gradle", patterns: ["/woodpecker/gradle"] },
] as const;

const Bytes = z.number().int().nonnegative();
export const WorkspaceUsageSchema = z.object({
  version: z.literal(1),
  elapsedMs: Bytes,
  filesystemUsedBytes: Bytes,
  categories: z
    .array(
      z.object({
        name: z.enum(WORKSPACE_USAGE_CATEGORIES.map(({ name }) => name)),
        bytes: Bytes.nullable(),
      }),
    )
    .length(WORKSPACE_USAGE_CATEGORIES.length),
});
export type WorkspaceUsage = z.infer<typeof WorkspaceUsageSchema>;

const DEADLINE_MS = 60_000;

async function existingPaths(root: string, patterns: readonly string[]) {
  const found: string[] = [];
  for (const pattern of patterns) {
    if (pattern.includes("*")) {
      for await (const match of new Bun.Glob(pattern).scan({
        cwd: root,
        onlyFiles: false,
        dot: true,
        followSymlinks: false,
      }))
        found.push(path.resolve(root, match));
      continue;
    }
    const absolute = path.resolve(root, pattern);
    try {
      await stat(absolute);
      found.push(absolute);
    } catch {
      // An absent path holds no bytes.
    }
  }
  return found;
}

async function measure(
  paths: readonly string[],
  signal: AbortSignal,
  du: readonly string[],
): Promise<number | null> {
  if (paths.length === 0) return 0;
  const child = Bun.spawn([...du, ...paths], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    signal,
  });
  const [output, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  // du still prints its total when a file vanishes mid-walk (exit 1).
  if (signal.aborted || (exitCode !== 0 && exitCode !== 1)) return null;
  const total = /^(\d+)\s+total$/mu.exec(
    output.trim().split("\n").at(-1) ?? "",
  );
  return total?.[1] === undefined ? null : Number(total[1]) * 1024;
}

export async function collectWorkspaceUsage(
  root: string,
  options: { deadlineMs?: number; du?: readonly string[] } = {},
): Promise<WorkspaceUsage> {
  const startedAt = Date.now();
  const signal = AbortSignal.timeout(options.deadlineMs ?? DEADLINE_MS);
  const du = options.du ?? ["du", "-skxc", "--"];
  const filesystem = await statfs(root);
  const categories = await Promise.all(
    WORKSPACE_USAGE_CATEGORIES.map(async ({ name, patterns }) => {
      try {
        return {
          name,
          bytes: await measure(await existingPaths(root, patterns), signal, du),
        };
      } catch {
        // A spawn failure or abort leaves only this category unmeasured.
        return { name, bytes: null };
      }
    }),
  );
  return WorkspaceUsageSchema.parse({
    version: 1,
    elapsedMs: Date.now() - startedAt,
    filesystemUsedBytes:
      (filesystem.blocks - filesystem.bfree) * filesystem.bsize,
    categories,
  });
}
