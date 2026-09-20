/**
 * Typed view of the Woodpecker CI environment.
 *
 * Scripts read the build through this module rather than reaching into
 * `Bun.env` directly, so a variable that CI stops providing fails in one place
 * with a name attached instead of surfacing as an empty string somewhere
 * downstream.
 *
 * During the migration this also read Buildkite's names, so a script could be
 * switched over while Buildkite was still the live gate. Those fallbacks are
 * gone: a stray `BUILDKITE_*` in an environment should not be able to satisfy
 * a required variable.
 *
 * Only variables with a real Woodpecker equivalent are here. Buildkite's job
 * UUID, agent access token, and hook variables have no counterpart, and
 * callers that needed them were rewritten rather than mapped.
 */

type Environment = Readonly<Record<string, string | undefined>>;

function read(environment: Environment, name: string): string | undefined {
  const value = environment[name];
  return value === undefined || value === "" ? undefined : value;
}

function required(environment: Environment, name: string): string {
  const value = read(environment, name);
  if (value === undefined) {
    throw new Error(`Missing required CI environment variable ${name}`);
  }
  return value;
}

/** True when running under CI. */
export function isCi(environment: Environment = Bun.env): boolean {
  return environment["CI"] === "true";
}

export function commitSha(environment: Environment = Bun.env): string {
  return required(environment, "CI_COMMIT_SHA");
}

export function branch(environment: Environment = Bun.env): string {
  return required(environment, "CI_COMMIT_BRANCH");
}

export function defaultBranch(environment: Environment = Bun.env): string {
  return read(environment, "CI_REPO_DEFAULT_BRANCH") ?? "main";
}

export function buildNumber(environment: Environment = Bun.env): number {
  const raw = required(environment, "CI_PIPELINE_NUMBER");
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`CI build number is not a positive integer: ${raw}`);
  }
  return parsed;
}

export function buildUrl(
  environment: Environment = Bun.env,
): string | undefined {
  return read(environment, "CI_PIPELINE_URL");
}

/**
 * Pull request number, or undefined on a branch or tag build.
 *
 * Woodpecker reports a non-PR build with a value rather than by omitting the
 * variable, so anything that is not a positive integer means "not a pull
 * request" rather than a parse failure.
 */
export function pullRequestNumber(
  environment: Environment = Bun.env,
): number | undefined {
  const raw = read(environment, "CI_COMMIT_PULL_REQUEST");
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function pullRequestBaseBranch(
  environment: Environment = Bun.env,
): string | undefined {
  return read(environment, "CI_COMMIT_TARGET_BRANCH");
}
