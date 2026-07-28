import { run } from "./lib/run.ts";
import { findEnvironmentVariableViolations } from "./environment-variable-rules.ts";

const SEARCH_EXTENSIONS = [
  ".ts",
  ".rs",
  ".py",
  ".fish",
  ".tmpl",
  ".yaml",
  ".yml",
  ".env",
  ".md",
  ".sh",
  ".swift",
];

const EXCLUDED_PATHS = new Set([
  "scripts/check-env-var-names.test.ts",
  "scripts/check-env-var-names.ts",
  "scripts/environment-variable-rules.ts",
  "packages/docs/decisions/2026-03-27_env-var-naming-convention.md",
  "packages/docs/guides/2026-04-04_homelab-health-audit-2.md",
]);

function isSearchablePath(path: string): boolean {
  if (
    path.startsWith("sandbox/archive/") ||
    path.startsWith("sandbox/practice/") ||
    path.startsWith(".build/") ||
    path.includes("/generated/") ||
    path.startsWith("packages/docs/archive/")
  ) {
    return false;
  }
  return (
    SEARCH_EXTENSIONS.some((extension) => path.endsWith(extension)) &&
    !EXCLUDED_PATHS.has(path)
  );
}

export async function checkEnvironmentVariableNames(): Promise<void> {
  const result = await run(["git", "ls-files", "-z"], {
    capture: true,
    secret: true,
  });
  const trackedPaths = result.stdout
    .split("\0")
    .filter((path) => isSearchablePath(path));
  const pathChecks = await Promise.all(
    trackedPaths.map(async (path) => ({
      exists: await Bun.file(path).exists(),
      path,
    })),
  );
  const existingPaths = pathChecks
    .filter(({ exists }) => exists)
    .map(({ path }) => path);
  const perFileViolations = await Promise.all(
    existingPaths.map(async (path) =>
      findEnvironmentVariableViolations(path, await Bun.file(path).text()),
    ),
  );
  const violations = perFileViolations.flat();

  for (const violation of violations) {
    console.error(
      `FAIL: Found banned pattern '${violation.pattern}' (use '${violation.replacement}' instead):`,
    );
    console.error(
      `  ${violation.path}:${violation.line.toString()}:${violation.text}`,
    );
    console.error("");
  }
  if (violations.length > 0) {
    throw new Error(
      `Found ${violations.length.toString()} banned environment variable pattern(s).`,
    );
  }
}

if (import.meta.main) {
  await checkEnvironmentVariableNames();
}
