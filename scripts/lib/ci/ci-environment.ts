/**
 * Provider-neutral view of the CI environment.
 *
 * Buildkite and Woodpecker describe the same build with different variable
 * names. Scripts read through this module so they work under either, which is
 * what makes the migration landable: Buildkite has to keep running until the
 * cutover, so no script may be switched over in a way that breaks it first.
 *
 * Woodpecker is preferred where both are present, so a step that sets both
 * during the transition behaves as the new system.
 *
 * Only variables with a genuine equivalent are here. Buildkite's job UUID,
 * agent access token, and hook variables have no Woodpecker counterpart, and
 * callers that need them must be rewritten rather than mapped.
 */

type Environment = Readonly<Record<string, string | undefined>>;

function read(
  environment: Environment,
  woodpecker: string,
  buildkite: string,
): string | undefined {
  const preferred = environment[woodpecker];
  if (preferred !== undefined && preferred !== "") return preferred;
  const fallback = environment[buildkite];
  return fallback === undefined || fallback === "" ? undefined : fallback;
}

function required(
  environment: Environment,
  woodpecker: string,
  buildkite: string,
): string {
  const value = read(environment, woodpecker, buildkite);
  if (value === undefined) {
    throw new Error(
      `Missing required CI environment variable ${woodpecker} (or ${buildkite})`,
    );
  }
  return value;
}

/** True when running under any supported CI provider. */
export function isCi(environment: Environment = Bun.env): boolean {
  return environment["CI"] === "true" || environment["BUILDKITE"] === "true";
}

export function commitSha(environment: Environment = Bun.env): string {
  return required(environment, "CI_COMMIT_SHA", "BUILDKITE_COMMIT");
}

export function branch(environment: Environment = Bun.env): string {
  return required(environment, "CI_COMMIT_BRANCH", "BUILDKITE_BRANCH");
}

export function defaultBranch(environment: Environment = Bun.env): string {
  return (
    read(
      environment,
      "CI_REPO_DEFAULT_BRANCH",
      "BUILDKITE_PIPELINE_DEFAULT_BRANCH",
    ) ?? "main"
  );
}

export function buildNumber(environment: Environment = Bun.env): number {
  const raw = required(
    environment,
    "CI_PIPELINE_NUMBER",
    "BUILDKITE_BUILD_NUMBER",
  );
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`CI build number is not a positive integer: ${raw}`);
  }
  return parsed;
}

export function buildUrl(
  environment: Environment = Bun.env,
): string | undefined {
  return read(environment, "CI_PIPELINE_URL", "BUILDKITE_BUILD_URL");
}

export function commitMessage(
  environment: Environment = Bun.env,
): string | undefined {
  return read(environment, "CI_COMMIT_MESSAGE", "BUILDKITE_MESSAGE");
}

export function repoCloneUrl(environment: Environment = Bun.env): string {
  return required(environment, "CI_REPO_CLONE_URL", "BUILDKITE_REPO");
}

export function workspacePath(
  environment: Environment = Bun.env,
): string | undefined {
  return read(environment, "CI_WORKSPACE", "BUILDKITE_BUILD_CHECKOUT_PATH");
}

/**
 * Pull request number, or undefined on a branch or tag build.
 *
 * Both providers report a non-PR build with a value rather than by omitting
 * the variable -- Buildkite uses the string "false" -- so anything that is not
 * a positive integer means "not a pull request" rather than a parse failure.
 */
export function pullRequestNumber(
  environment: Environment = Bun.env,
): number | undefined {
  const raw = read(
    environment,
    "CI_COMMIT_PULL_REQUEST",
    "BUILDKITE_PULL_REQUEST",
  );
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function pullRequestBaseBranch(
  environment: Environment = Bun.env,
): string | undefined {
  return read(
    environment,
    "CI_COMMIT_TARGET_BRANCH",
    "BUILDKITE_PULL_REQUEST_BASE_BRANCH",
  );
}
