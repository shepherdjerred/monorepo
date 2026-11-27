import { describe, expect, test } from "vitest";
import { selectSteps } from "#src/pipeline/select.ts";
import { TEST_IMAGES, testPipelineSteps } from "./identity.ts";
import { signRemoteCacheSteps } from "#src/pipeline/turbo-cache.ts";
import { grantGradleBuildCache } from "#src/pipeline/gradle-build-cache.ts";
import { grantSccacheWebdav } from "#src/pipeline/sccache-webdav.ts";
import {
  cacheTrustDomain,
  type CacheTrustDomain,
} from "#src/pipeline/cache-trust-domain.ts";
import { credentiallessHostedAutomationSteps } from "#src/pipeline/steps.ts";
import { authorizePipeline } from "#src/authorization.ts";
import {
  EXTENDED_STEP_KEY,
  extendedRequest,
  extendedSteps,
} from "#src/pipeline/extended.ts";
import { PipelineSchema } from "#src/schemas.ts";
import fixture from "./fixtures/woodpecker-v3.18.1-config-request.json" with { type: "json" };

/**
 * What a pull request can reach.
 *
 * A pull request is the least trusted thing that runs this pipeline, so the
 * set of credentials within its reach is a boundary worth stating rather than
 * leaving to be rediscovered. It was rediscovered once already: because
 * Woodpecker reports the TARGET branch for pull-request events, selecting
 * default-branch-only steps on branch identity alone put the entire release
 * chain -- infrastructure applies, package publishes, ArgoCD syncs -- one pull
 * request away from running.
 *
 * These tests measure the real step model rather than fixtures. The empty
 * changed-file list is deliberate: `changedGuardMatches` treats "we could not
 * determine what changed" as "select it", so an empty list yields the MAXIMAL
 * pull-request-reachable set. That is the set worth bounding.
 *
 * Who opened the pull request changes exactly one thing: which remote build
 * cache it joins. `cacheTrustDomain` gives the owner and his agent account
 * main's trusted cache, so their pull requests and main reuse each other's
 * Turbo, Gradle and sccache work. Every other shape stays in the isolated
 * pull-request cache. The shapes below are resolved through that function, so
 * a change to the rule shows up here as a change to what a pull request holds.
 */

const allSteps = testPipelineSteps;

function credentialHolders(env: string): string[] {
  return allSteps()
    .filter((step) => step.secrets?.some((grant) => grant.env === env))
    .map((step) => step.key)
    .sort();
}

/** The worst case: a pull request against the default branch, touching anything. */
const pullRequestAgainstMain = (
  steps: ReturnType<typeof allSteps>,
  trustDomain: CacheTrustDomain = "pull-request",
) =>
  grantSccacheWebdav(
    grantGradleBuildCache(
      signRemoteCacheSteps(
        selectSteps(steps, {
          event: "pull_request",
          branch: "main",
          defaultBranch: "main",
          changedFiles: [],
        }),
        trustDomain,
      ),
      trustDomain,
    ),
    trustDomain,
  );

/** A same-repository pull request as the forge reports it. */
const pullRequestBy = (overrides: Record<string, unknown>) =>
  PipelineSchema.parse({ ...fixture.pipeline, ...overrides });

/** The owner's own pull requests, which share main's trusted cache. */
const OWNER_PULL_REQUESTS = [
  {
    shape: "the owner",
    pipeline: pullRequestBy({
      author: "shepherdjerred",
      sender: "shepherdjerred",
    }),
  },
  {
    shape: "the agent account",
    pipeline: pullRequestBy({ author: "derrej", sender: "derrej" }),
  },
];

/**
 * Pull requests that must stay in the isolated cache. `admitted` records
 * whether the pipeline runs at all: forks and unknown actors are refused
 * before any step exists, and the cache rule refuses them again.
 */
const ISOLATED_PULL_REQUESTS = [
  {
    shape: "Renovate",
    pipeline: pullRequestBy({
      author: "renovate[bot]",
      sender: "renovate[bot]",
    }),
    credentialless: false,
    admitted: true,
  },
  {
    shape: "credentialless automation",
    pipeline: pullRequestBy({
      author: "renovate[bot]",
      sender: "renovate[bot]",
    }),
    credentialless: true,
    admitted: true,
  },
  {
    shape: "a fork",
    pipeline: pullRequestBy({
      author: "shepherdjerred",
      sender: "shepherdjerred",
      from_fork: true,
    }),
    credentialless: false,
    admitted: false,
  },
  {
    shape: "an unknown actor",
    pipeline: pullRequestBy({ author: "octocat", sender: "octocat" }),
    credentialless: false,
    admitted: false,
  },
  {
    shape: "an owner GitHub App",
    pipeline: pullRequestBy({
      author: "long-summer-intern[bot]",
      sender: "long-summer-intern[bot]",
    }),
    credentialless: false,
    admitted: true,
  },
];

/** A push to the default branch, touching anything. */
const defaultBranchPush = (steps: ReturnType<typeof allSteps>) =>
  grantSccacheWebdav(
    grantGradleBuildCache(
      signRemoteCacheSteps(
        selectSteps(steps, {
          event: "push",
          branch: "main",
          defaultBranch: "main",
          changedFiles: [],
        }),
        "trusted",
      ),
      "trusted",
    ),
    "trusted",
  );

/**
 * Every credential a pull request can put in front of a step, sorted.
 *
 * Treat a diff here as a security review, not a test to re-record. Adding a
 * name means a pull request -- including one whose only purpose is to change
 * this pipeline -- can now read that credential.
 *
 * Automated PR review moved to Temporal (`ci/code-review`), removing GitHub
 * App and review-comment credentials from pull-request CI pods. Everything
 * below supports verification or build handoff access:
 *
 * - `GITHUB_DOWNLOAD_TOKEN` downloads pinned release binaries for mise/checks.
 * - `SEAWEEDFS_HANDOFF_*` reaches only the `ci-handoff` bucket.
 * - OpenTofu validation is offline and has no provider or state credentials.
 * - `GRADLE_BUILD_CACHE_READ_PASSWORD` is the Gradle cache's read-only user.
 *
 * This is the set for every pull request outside the owner's own.
 */
const PR_REACHABLE_SECRETS = [
  "GITHUB_DOWNLOAD_TOKEN",
  "GRADLE_BUILD_CACHE_READ_PASSWORD",
  "SCCACHE_WEBDAV_PASSWORD",
  "SEAWEEDFS_HANDOFF_ACCESS_KEY_ID",
  "SEAWEEDFS_HANDOFF_SECRET_ACCESS_KEY",
  "TURBO_REMOTE_CACHE_SIGNATURE_KEY",
  "TURBO_TOKEN",
];

/**
 * What the owner's own pull requests reach: the same set, with the trusted
 * cache's write identity in place of the read-only one. Nothing that
 * publishes, deploys or mutates infrastructure is added.
 */
const OWNER_PR_REACHABLE_SECRETS = [
  "GITHUB_DOWNLOAD_TOKEN",
  "GRADLE_BUILD_CACHE_WRITE_PASSWORD",
  "SCCACHE_WEBDAV_PASSWORD",
  "SEAWEEDFS_HANDOFF_ACCESS_KEY_ID",
  "SEAWEEDFS_HANDOFF_SECRET_ACCESS_KEY",
  "TURBO_REMOTE_CACHE_SIGNATURE_KEY",
  "TURBO_TOKEN",
];

/**
 * The trusted cache's write identity, by Secret key. Keys rather than
 * environment names, because the Turbo signing key and the sccache password
 * arrive under the same variable in either domain. Main and the owner's pull
 * requests hold these; no other pull request may.
 */
const TRUSTED_CACHE_KEYS = [
  "GRADLE_BUILD_CACHE_WRITE_PASSWORD",
  "TURBO_REMOTE_CACHE_SIGNATURE_KEY_TRUSTED",
];

/**
 * Credentials that must never be reachable from any pull request, named
 * individually so the assertion says what it is protecting. Each belongs to a
 * step that publishes, deploys, or mutates infrastructure.
 */
const RELEASE_ONLY_SECRETS = [
  "DOCKERHUB_USERNAME",
  "DOCKERHUB_PUBLISH_TOKEN",
  "DOCKERHUB_READ_CONFIG_JSON",
  "NPM_TOKEN",
  "CHARTMUSEUM_USERNAME",
  "CHARTMUSEUM_PASSWORD",
  "DELIVERY_ARCHIVE_PUBLISHER_ACCESS_KEY_ID",
  "DELIVERY_ARCHIVE_PUBLISHER_SECRET_ACCESS_KEY",
];

const grantKeys = (steps: ReturnType<typeof allSteps>) =>
  new Set(steps.flatMap((step) => (step.secrets ?? []).map((g) => g.key)));

const grantEnvs = (steps: ReturnType<typeof allSteps>) =>
  new Set(steps.flatMap((step) => (step.secrets ?? []).map((g) => g.env)));

/**
 * Exactly the steps allowed to write a published site or release archive.
 *
 * Closed-world on purpose. Nothing in this repository checks for an
 * *excessive* grant -- `check-ci-env` only reports a step that cannot meet a
 * requirement -- so a step quietly gaining the site-write identity would
 * otherwise pass every check while widening what a build can overwrite.
 */

describe("what a pull request can reach", () => {
  test("grants registry writes only to publishers and reads only to site extraction", () => {
    expect(credentialHolders("DOCKERHUB_PUBLISH_TOKEN")).toEqual([
      "ci-base-refresh",
      "ci-playwright-refresh",
      "helm-push",
      "images",
    ]);
    expect(credentialHolders("DOCKERHUB_READ_CONFIG_JSON")).toEqual([
      "scout-site-archives",
    ]);
    for (const step of allSteps()) {
      for (const grant of step.secrets ?? []) {
        if (grant.env === "DOCKERHUB_PUBLISH_TOKEN") {
          expect(grant.secret).toBe("ci-dockerhub-publisher-credentials");
          expect(step.commands).toContain(
            "bun --no-install ci/scripts/reporting/dockerhub-env.ts",
          );
        }
        if (grant.env === "DOCKERHUB_READ_CONFIG_JSON") {
          expect(grant).toEqual({
            secret: "dockerhub-pull-woodpecker-ci",
            key: ".dockerconfigjson",
            env: "DOCKERHUB_READ_CONFIG_JSON",
          });
          expect(step.commands).toContain(
            "bun --no-install ci/scripts/reporting/dockerhub-env.ts --reader",
          );
        }
      }
    }
  });
  test("selects no default-branch-only step", () => {
    const steps = allSteps();
    const mainOnly = new Set(
      steps.filter((step) => step.defaultBranchOnly === true).map((s) => s.key),
    );
    // Guards against the assertion passing because the model went empty.
    expect(mainOnly.size).toBeGreaterThan(0);

    const reached = pullRequestAgainstMain(steps)
      .filter((step) => mainOnly.has(step.key))
      .map((step) => step.key);
    expect(reached).toEqual([]);
  });

  test.each(ISOLATED_PULL_REQUESTS)(
    "a pull request from $shape reaches exactly the reviewed set and no trusted cache credential",
    ({ pipeline, credentialless, admitted }) => {
      expect(authorizePipeline(pipeline).allowed).toBe(admitted);
      const trustDomain = cacheTrustDomain({
        proposal: true,
        credentialless,
        pipeline,
      });
      expect(trustDomain).toBe("pull-request");
      const steps = pullRequestAgainstMain(allSteps(), trustDomain);
      expect([...grantEnvs(steps)].sort()).toEqual(PR_REACHABLE_SECRETS);
      const keys = grantKeys(steps);
      for (const key of TRUSTED_CACHE_KEYS)
        expect(keys.has(key), `${key} must not reach this PR`).toBe(false);
    },
  );

  test("credentialless automation holds no credential at all", () => {
    expect(
      credentiallessHostedAutomationSteps(TEST_IMAGES).flatMap(
        (step) => step.secrets ?? [],
      ),
    ).toEqual([]);
  });

  test.each(OWNER_PULL_REQUESTS)(
    "a pull request from $shape adds only the trusted cache identity to the reviewed set",
    ({ pipeline }) => {
      const trustDomain = cacheTrustDomain({
        proposal: true,
        credentialless: false,
        pipeline,
      });
      expect(trustDomain).toBe("trusted");
      const steps = pullRequestAgainstMain(allSteps(), trustDomain);
      expect([...grantEnvs(steps)].sort()).toEqual(OWNER_PR_REACHABLE_SECRETS);
      const keys = grantKeys(steps);
      for (const key of TRUSTED_CACHE_KEYS)
        expect(keys.has(key), key).toBe(true);
      expect(keys.has("TURBO_REMOTE_CACHE_SIGNATURE_KEY_PR")).toBe(false);
      expect(keys.has("GRADLE_BUILD_CACHE_READ_PASSWORD")).toBe(false);
    },
  );

  test("isolates pull-request cache entries from the trusted namespace", () => {
    const remoteCacheSteps = pullRequestAgainstMain(allSteps()).filter((step) =>
      step.secrets?.some((grant) => grant.env === "TURBO_TOKEN"),
    );
    expect(remoteCacheSteps.length).toBeGreaterThan(0);
    expect(
      remoteCacheSteps.every(
        (step) => step.environment?.["TURBO_TEAM"] === "monorepo-pull-request",
      ),
    ).toBe(true);

    // Main and the owner's pull requests share one namespace.
    for (const trusted of [
      defaultBranchPush(allSteps()),
      pullRequestAgainstMain(allSteps(), "trusted"),
    ]) {
      const trustedCacheSteps = trusted.filter((step) =>
        step.secrets?.some((grant) => grant.env === "TURBO_TOKEN"),
      );
      expect(trustedCacheSteps.length).toBeGreaterThan(0);
      expect(
        trustedCacheSteps.every(
          (step) => step.environment?.["TURBO_TEAM"] === "monorepo",
        ),
      ).toBe(true);
    }
  });

  test.each(["pull-request", "trusted"] as const)(
    "keeps publishing and chart-push credentials out of reach of a %s-cache PR",
    (trustDomain) => {
      const reachable = grantEnvs(
        pullRequestAgainstMain(allSteps(), trustDomain),
      );
      for (const secret of RELEASE_ONLY_SECRETS) {
        expect(reachable.has(secret), `${secret} must not reach a PR`).toBe(
          false,
        );
      }
    },
  );

  /**
   * The site-write identity is the one that can overwrite a published site, so
   * it gets its own closed-world assertion rather than riding on the set
   * above: which steps hold it matters as much as whether a pull request can.
   */
  test("no CI step receives live site-write credentials", () => {
    const holders = allSteps()
      .filter((step) =>
        (step.secrets ?? []).some((grant) =>
          grant.env.startsWith("SEAWEEDFS_SITES_"),
        ),
      )
      .map((step) => step.key)
      .sort();
    expect(holders).toEqual([]);
  });

  /**
   * The same credentials must still reach the release chain on a push to the
   * default branch -- otherwise this boundary could be "held" by a selector
   * that quietly stopped selecting anything.
   */
  test("still grants them on a push to the default branch", () => {
    const selected = defaultBranchPush(allSteps());
    const reachable = new Set(
      selected.flatMap((step) =>
        (step.secrets ?? []).map((grant) => grant.env),
      ),
    );
    for (const secret of RELEASE_ONLY_SECRETS) {
      expect(reachable.has(secret), `${secret} must reach a main push`).toBe(
        true,
      );
    }
    const keys = grantKeys(selected);
    for (const key of TRUSTED_CACHE_KEYS)
      expect(keys.has(key), `${key} must reach a main push`).toBe(true);
  });
});

describe("cache write boundaries and extended tier", () => {
  /**
   * Gradle cache entries are build outputs that later builds load instead of
   * compiling, so a writer is as trusted as the code it builds. Only verify in
   * the trusted domain -- main, and the owner's own pull requests -- may store
   * entries; every other pull request reads.
   */
  test("lets only trusted-domain verify write the Gradle build cache", () => {
    const holders = (
      steps: ReturnType<typeof allSteps>,
      env: string,
    ): string[] =>
      steps
        .filter((step) => step.secrets?.some((grant) => grant.env === env))
        .map((step) => step.key)
        .sort();
    const main = defaultBranchPush(allSteps());
    const pullRequest = pullRequestAgainstMain(allSteps());
    for (const trusted of [
      main,
      pullRequestAgainstMain(allSteps(), "trusted"),
    ]) {
      expect(holders(trusted, "GRADLE_BUILD_CACHE_WRITE_PASSWORD")).toEqual([
        "verify",
      ]);
      expect(holders(trusted, "GRADLE_BUILD_CACHE_READ_PASSWORD")).toEqual([]);
    }
    expect(holders(pullRequest, "GRADLE_BUILD_CACHE_READ_PASSWORD")).toEqual([
      "verify",
    ]);
    expect(holders(pullRequest, "GRADLE_BUILD_CACHE_WRITE_PASSWORD")).toEqual(
      [],
    );
    expect(
      pullRequest.find((step) => step.key === "verify")?.environment,
    ).toMatchObject({
      GRADLE_BUILD_CACHE_USERNAME: "ci-pull-request",
      SCCACHE_WEBDAV_USERNAME: "ci-pull-request",
    });
    expect(
      main.find((step) => step.key === "verify")?.environment,
    ).toMatchObject({
      GRADLE_BUILD_CACHE_USERNAME: "ci-main",
      SCCACHE_WEBDAV_USERNAME: "ci-main",
    });
    expect(
      pullRequest
        .flatMap((step) => step.secrets ?? [])
        .filter((grant) => grant.env === "SCCACHE_WEBDAV_PASSWORD"),
    ).toEqual([
      {
        secret: "ci-gradle-build-cache-credentials",
        key: "GRADLE_BUILD_CACHE_READ_PASSWORD",
        env: "SCCACHE_WEBDAV_PASSWORD",
      },
    ]);
    expect(
      main
        .flatMap((step) => step.secrets ?? [])
        .filter((grant) => grant.env === "SCCACHE_WEBDAV_PASSWORD"),
    ).toEqual([
      {
        secret: "ci-gradle-build-cache-credentials",
        key: "GRADLE_BUILD_CACHE_WRITE_PASSWORD",
        env: "SCCACHE_WEBDAV_PASSWORD",
      },
    ]);
  });

  test("keeps Argo credentials out of every pull-request workflow", () => {
    const holders = pullRequestAgainstMain(allSteps()).filter((step) =>
      step.secrets?.some((grant) => grant.env === "ARGOCD_AUTH_TOKEN"),
    );
    expect(holders).toEqual([]);
  });

  /**
   * The extended tier is a main-only holder of the trusted Turbo signing key
   * and the Gradle write password, beside trusted-domain verify.
   * It is not in the selected graph at all, and its request parser refuses
   * every pull-request shape, so no pull request can reach it; its grants are
   * pinned here so widening them is a reviewed change.
   */
  test("cannot reach the extended test tier, whose grants are verify's trusted set", () => {
    expect(allSteps().map((step) => step.key)).not.toContain(EXTENDED_STEP_KEY);
    const request = {
      request: "8f6d3a2e-4c1b-4e7a-9f0d-2b5c6d7e8f90",
      source: fixture.pipeline.commit,
    };
    const pullRequest = PipelineSchema.parse({
      ...fixture.pipeline,
      variables: {
        CI_EXTENDED_REQUEST: request.request,
        CI_EXTENDED_SOURCE: request.source,
      },
    });
    for (const event of ["pull_request", "pull_request_metadata", "push"])
      expect(() =>
        extendedRequest({ ...pullRequest, event }, "main", true),
      ).toThrow("exclusive owner manual request");
    const [extended] = extendedSteps(TEST_IMAGES, request);
    const mainVerify = defaultBranchPush(allSteps()).find(
      (step) => step.key === "verify",
    );
    // Same identities as main's verify: handoff bucket, trusted Turbo cache,
    // Gradle write user, GitHub downloads. Nothing that publishes or deploys.
    expect(extended?.secrets?.map((grant) => grant.key).toSorted()).toEqual(
      mainVerify?.secrets?.map((grant) => grant.key).toSorted(),
    );
    for (const secret of RELEASE_ONLY_SECRETS)
      expect(
        extended?.secrets?.some((grant) => grant.env === secret),
        secret,
      ).toBe(false);
  });
});
