import { run } from "./lib/run.ts";
import { existingFiles } from "./migration-core.ts";

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
