import { run } from "./run.ts";

/** Return tracked paths that still exist in the working tree. */
export async function trackedExistingFiles(
  patterns: readonly string[] = [],
): Promise<string[]> {
  const result = await run(["git", "ls-files", "-z", ...patterns], {
    capture: true,
    secret: true,
  });
  const trackedPaths = result.stdout.split("\0").filter((path) => path !== "");
  const checks = await Promise.all(
    trackedPaths.map(async (path) => ({
      exists: await Bun.file(path).exists(),
      path,
    })),
  );
  return checks.filter(({ exists }) => exists).map(({ path }) => path);
}
