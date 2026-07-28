import { run } from "./lib/run.ts";
import { findEnvironmentVariableViolations } from "./environment-variable-rules.ts";
import { isSearchableEnvironmentVariablePath } from "./migration-core.ts";

export async function checkEnvironmentVariableNames(
  requestedPaths?: readonly string[],
): Promise<void> {
  let candidatePaths: string[];
  if (requestedPaths === undefined || requestedPaths.length === 0) {
    const result = await run(["git", "ls-files", "-z"], {
      capture: true,
      secret: true,
    });
    candidatePaths = result.stdout.split("\0");
  } else {
    candidatePaths = [...requestedPaths];
  }
  const trackedPaths = candidatePaths.filter((path) =>
    isSearchableEnvironmentVariablePath(path),
  );
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
  const requestedPaths = Bun.argv.slice(2);
  await checkEnvironmentVariableNames(
    requestedPaths.length === 0 ? undefined : requestedPaths,
  );
}
