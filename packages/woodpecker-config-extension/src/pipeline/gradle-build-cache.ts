import type { CiStep, SecretGrant } from "#src/pipeline/model.ts";

/**
 * The remote Gradle build cache shared by CI's Gradle builds.
 *
 * CI's `GRADLE_USER_HOME` belongs to one workflow, so Gradle's local build
 * cache starts empty on every run. The homelab's nginx WebDAV cache
 * (`packages/homelab/src/cdk8s/src/resources/gradle-build-cache.ts`) keeps
 * task outputs across runs; The Storm's `plugin/settings.gradle.kts` enables
 * it only when this URL is in the environment, so local builds are unchanged.
 */
const GRADLE_BUILD_CACHE_URL =
  "https://gradle-build-cache.tailnet-1a49.ts.net/cache/";

/** The CI credential Secret; one 1Password item holds both passwords. */
const GRADLE_BUILD_CACHE_SECRET = "ci-gradle-build-cache-credentials";

type GradleCacheTrustDomain = "trusted" | "pull-request";

/**
 * One cache identity per trust domain.
 *
 * The server enforces `level`: only `readwrite` users are in the htpasswd
 * file nginx checks for PUT, so a pull request holding the read password
 * cannot store an entry even if its build asks to push. That is the
 * cache-poisoning boundary: only default-branch builds write outputs that
 * later builds, including pull requests, load instead of compiling.
 * The homelab server's htpasswd files are rendered from this table.
 */
export const GRADLE_BUILD_CACHE_USERS = {
  trusted: {
    username: "ci-main",
    passwordKey: "GRADLE_BUILD_CACHE_WRITE_PASSWORD",
    level: "readwrite",
  },
  "pull-request": {
    username: "ci-pull-request",
    passwordKey: "GRADLE_BUILD_CACHE_READ_PASSWORD",
    level: "read",
  },
} as const satisfies Record<
  GradleCacheTrustDomain,
  {
    readonly username: string;
    readonly passwordKey: string;
    readonly level: "read" | "readwrite";
  }
>;

/** Marks a step whose Gradle builds use the remote cache. */
export const GRADLE_BUILD_CACHE_ENVIRONMENT = {
  GRADLE_BUILD_CACHE_URL,
} as const;

/** The same environment with the Gradle cache disabled. */
export function withoutGradleBuildCache(
  environment: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment ?? {}).filter(
      ([name]) => !(name in GRADLE_BUILD_CACHE_ENVIRONMENT),
    ),
  );
}

function gradleBuildCachePassword(
  trustDomain: GradleCacheTrustDomain,
): SecretGrant {
  const { passwordKey } = GRADLE_BUILD_CACHE_USERS[trustDomain];
  return {
    secret: GRADLE_BUILD_CACHE_SECRET,
    key: passwordKey,
    env: passwordKey,
  };
}

/**
 * Give each step that names the Gradle cache exactly one trust domain's
 * identity. Gradle pushes only when the write password is present, and the
 * build fails loudly when the URL arrives without either password.
 */
export function grantGradleBuildCache(
  steps: readonly CiStep[],
  trustDomain: GradleCacheTrustDomain,
): CiStep[] {
  return steps.map((step) => {
    if (step.environment?.["GRADLE_BUILD_CACHE_URL"] === undefined) return step;
    return {
      ...step,
      environment: {
        ...step.environment,
        GRADLE_BUILD_CACHE_USERNAME:
          GRADLE_BUILD_CACHE_USERS[trustDomain].username,
      },
      secrets: [...(step.secrets ?? []), gradleBuildCachePassword(trustDomain)],
    };
  });
}
