import { run } from "./lib/run.ts";

/**
 * A tracked file is a hadolint candidate when it is named like a Dockerfile
 * (`Dockerfile`, `Dockerfile.<variant>`, or `<name>.Dockerfile`) and lives
 * outside `sandbox/` (personal scratch, excluded from repo-wide gates).
 */
export function isHadolintCandidate(path: string): boolean {
  if (path.startsWith("sandbox/")) return false;
  const basename = path.split("/").at(-1);
  if (basename === undefined) return false;
  return (
    basename === "Dockerfile" ||
    basename.startsWith("Dockerfile.") ||
    basename.endsWith(".Dockerfile")
  );
}

export async function checkDockerfiles(): Promise<void> {
  const result = await run(["git", "ls-files", "-z"], {
    capture: true,
    secret: true,
  });
  const candidates = result.stdout
    .split("\0")
    .filter((path) => path !== "" && isHadolintCandidate(path));
  const candidateChecks = await Promise.all(
    candidates.map(async (path) => ({
      exists: await Bun.file(path).exists(),
      path,
    })),
  );
  const files = candidateChecks
    .filter(({ exists }) => exists)
    .map(({ path }) => path);
  // Non-vacuity guard: this repo ships container images, so an empty candidate
  // list means the discovery patterns broke, not that there is nothing to lint.
  if (files.length === 0) {
    throw new Error(
      "hadolint: no Dockerfiles found — the discovery patterns are broken",
    );
  }
  await run(["hadolint", "--config", ".hadolint.yaml", ...files]);
}

if (import.meta.main) {
  await checkDockerfiles();
}
