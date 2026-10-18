import { describe, expect, test } from "vitest";
import { selectSteps } from "#src/pipeline/select.ts";
import { testPipelineSteps } from "./identity.ts";
import { signRemoteCacheSteps } from "#src/pipeline/turbo-cache.ts";

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
 */

const allSteps = testPipelineSteps;

function credentialHolders(env: string): string[] {
  return allSteps()
    .filter((step) => step.secrets?.some((grant) => grant.env === env))
    .map((step) => step.key)
    .sort();
}

/** The worst case: a pull request against the default branch, touching anything. */
const pullRequestAgainstMain = (steps: ReturnType<typeof allSteps>) =>
  signRemoteCacheSteps(
    selectSteps(steps, {
      event: "pull_request",
      branch: "main",
      defaultBranch: "main",
      changedFiles: [],
    }),
    "pull-request",
  );

/**
 * Every credential a pull request can put in front of a step, sorted.
 *
 * Treat a diff here as a security review, not a test to re-record. Adding a
 * name means a pull request -- including one whose only purpose is to change
 * this pipeline -- can now read that credential.
 *
 * Everything below supports verification or build handoff access:
 *
 * - `codex-review-gate` mints a review token.
 * - `SEAWEEDFS_HANDOFF_*` reaches only the `ci-handoff` bucket.
 * - OpenTofu validation is offline and has no provider or state credentials.
 */
const PR_REACHABLE_SECRETS = [
  "GITHUB_APP_ID",
  "GITHUB_APP_INSTALLATION_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_DOWNLOAD_TOKEN",
  "GITHUB_REVIEW_TOKEN",
  "SEAWEEDFS_HANDOFF_ACCESS_KEY_ID",
  "SEAWEEDFS_HANDOFF_SECRET_ACCESS_KEY",
  "TURBO_REMOTE_CACHE_SIGNATURE_KEY",
  "TURBO_TOKEN",
];

/**
 * Credentials that must never be reachable from a pull request, named
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

  test("puts exactly the reviewed set of credentials within reach", () => {
    const reachable = new Set<string>();
    for (const step of pullRequestAgainstMain(allSteps())) {
      for (const grant of step.secrets ?? []) reachable.add(grant.env);
    }
    expect([...reachable].sort()).toEqual(PR_REACHABLE_SECRETS);
  });

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

    const trustedCacheSteps = signRemoteCacheSteps(
      selectSteps(allSteps(), {
        event: "push",
        branch: "main",
        defaultBranch: "main",
        changedFiles: [],
      }),
      "trusted",
    ).filter((step) =>
      step.secrets?.some((grant) => grant.env === "TURBO_TOKEN"),
    );
    expect(trustedCacheSteps.length).toBeGreaterThan(0);
    expect(
      trustedCacheSteps.every(
        (step) => step.environment?.["TURBO_TEAM"] === "monorepo",
      ),
    ).toBe(true);
  });

  test("keeps publishing and chart-push credentials out of reach", () => {
    const reachable = new Set(
      pullRequestAgainstMain(allSteps()).flatMap((step) =>
        (step.secrets ?? []).map((grant) => grant.env),
      ),
    );
    for (const secret of RELEASE_ONLY_SECRETS) {
      expect(reachable.has(secret), `${secret} must not reach a PR`).toBe(
        false,
      );
    }
  });

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
    const selected = signRemoteCacheSteps(
      selectSteps(allSteps(), {
        event: "push",
        branch: "main",
        defaultBranch: "main",
        changedFiles: [],
      }),
      "trusted",
    );
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
  });

  test("keeps Argo credentials out of every pull-request workflow", () => {
    const holders = pullRequestAgainstMain(allSteps()).filter((step) =>
      step.secrets?.some((grant) => grant.env === "ARGOCD_AUTH_TOKEN"),
    );
    expect(holders).toEqual([]);
  });
});
