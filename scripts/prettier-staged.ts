import { run } from "./lib/run.ts";

export async function existingFiles(paths: string[]): Promise<string[]> {
  const checks = await Promise.all(
    paths.map(async (path) => ({
      exists: await Bun.file(path).exists(),
      path,
    })),
  );
  return checks.filter(({ exists }) => exists).map(({ path }) => path);
}

export async function checkStagedFormatting(paths: string[]): Promise<void> {
  const files = await existingFiles(paths);
  if (files.length === 0) {
    console.log("prettier-staged: no existing staged files to check");
    return;
  }
  await run(["bunx", "prettier", "--check", ...files]);
}

if (import.meta.main) {
  await checkStagedFormatting(Bun.argv.slice(2));
}
