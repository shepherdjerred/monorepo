import { run } from "./lib/run.ts";

export function isShellcheckCandidate(path: string): boolean {
  return !(
    path.includes("/archive/") ||
    path.includes("wasm-src/") ||
    path.includes("/Pods/") ||
    path.includes("/target/")
  );
}

export async function checkShellScripts(): Promise<void> {
  const result = await run(["git", "ls-files", "-z", "*.sh"], {
    capture: true,
    secret: true,
  });
  const candidates = result.stdout
    .split("\0")
    .filter((path) => path !== "" && isShellcheckCandidate(path));
  const candidateChecks = await Promise.all(
    candidates.map(async (path) => ({
      exists: await Bun.file(path).exists(),
      path,
    })),
  );
  const files = candidateChecks
    .filter(({ exists }) => exists)
    .map(({ path }) => path);
  if (files.length === 0) {
    console.log("no shell scripts to check");
    return;
  }
  await run(["shellcheck", "--severity=warning", ...files]);
}

if (import.meta.main) {
  await checkShellScripts();
}
