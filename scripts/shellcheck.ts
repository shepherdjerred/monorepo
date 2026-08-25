import { run } from "./lib/run.ts";
import { isShellcheckCandidate } from "./migration-core.ts";
import { trackedExistingFiles } from "./lib/tracked-files.ts";

export async function checkShellScripts(): Promise<void> {
  const trackedFiles = await trackedExistingFiles(["*.sh"]);
  const files = trackedFiles.filter((path) => isShellcheckCandidate(path));
  if (files.length === 0) {
    console.log("no shell scripts to check");
    return;
  }
  await run(["shellcheck", "--severity=warning", ...files]);
}

if (import.meta.main) {
  await checkShellScripts();
}
