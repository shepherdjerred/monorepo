import { describe, expect, test } from "vitest";
import { selectSteps } from "#src/pipeline/select.ts";
import { testPipelineSteps } from "./identity.ts";

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

/** The worst case: a pull request against the default branch, touching anything. */
const pullRequestAgainstMain = (steps: ReturnType<typeof allSteps>) =>
  selectSteps(steps, {
    event: "pull_request",
    branch: "main",
    defaultBranch: "main",
    changedFiles: [],
  });

/**
 * Every credential a pull request can put in front of a step, sorted.
 *
 * Treat a diff here as a security review, not a test to re-record. Adding a
 * name means a pull request -- including one whose only purpose is to change
 * this pipeline -- can now read that credential.
 *
 * Everything below is plan-time or check-time access that a pull request
 * genuinely needs:
 *
 * - `tofu-plan-*` hold their stack's provider credentials because a plan has
 *   to talk to the provider. They are the reason most of this list exists.
 * - `codex-review-gate` mints a review token; `pr-dryrun` reads ArgoCD.
 * - `GITHUB_PACKAGES_TOKEN` can publish packages, and reaches
 *   `windows-cross-compiler-pr` although that step only reads: its build
 *   imports cache from a private ghcr package, and without registry login
 *   BuildKit silently rebuilds from scratch past the lane's timeout. Accepted
 *   deliberately to match the Buildkite lane it replaces; a read-only
 *   packages token would remove it from this list.
 * - The SeaweedFS names are three distinct identities, each scoped in the
 *   gateway to the buckets its job touches. `SEAWEEDFS_HANDOFF_*` reaches only
 *   the `ci-handoff` bucket and `SEAWEEDFS_TOFU_STATE_*` only
 *   `homelab-tofu-state`, so neither can touch a published site.
 * - `SEAWEEDFS_APPLE_SDKS_*` lets `macos-cross-compiler-pr` read the private
 *   Apple SDK tarballs its smoke build needs. Read and list on that one bucket
 *   only; the Buildkite lane it replaces held the cluster-wide deploy key.
 * - `SEAWEEDFS_TOFU_ADMIN_*` is the one genuinely broad credential left here.
 *   It belongs to `tofu-plan-seaweedfs`, whose stack manages the buckets
 *   themselves, and SeaweedFS requires unscoped `Admin` to create one.
 *   Narrowing it means moving bucket management off the pull-request path,
 *   which is a change to the pipeline's shape rather than to its grants.
 */
const PR_REACHABLE_SECRETS = [
  "ANIMEZ_PASSWORD",
  "ANIMEZ_PID",
  "ARGOCD_AUTH_TOKEN",
  "AVISTAZ_PASSWORD",
  "AVISTAZ_PID",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "GITHUB_APP_ID",
  "GITHUB_APP_INSTALLATION_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_DOWNLOAD_TOKEN",
  "GITHUB_PACKAGES_TOKEN",
  "GITHUB_REVIEW_TOKEN",
  "OPENROUTER_API_KEY",
  "PRIVATEHD_PASSWORD",
  "PRIVATEHD_PID",
  "PROWLARR_API_KEY",
  "QBITTORRENT_PASSWORD",
  "RADARR_API_KEY",
  "SEAWEEDFS_APPLE_SDKS_ACCESS_KEY_ID",
  "SEAWEEDFS_APPLE_SDKS_SECRET_ACCESS_KEY",
  "SEAWEEDFS_HANDOFF_ACCESS_KEY_ID",
  "SEAWEEDFS_HANDOFF_SECRET_ACCESS_KEY",
  "SEAWEEDFS_TOFU_ADMIN_ACCESS_KEY_ID",
  "SEAWEEDFS_TOFU_ADMIN_SECRET_ACCESS_KEY",
  "SEAWEEDFS_TOFU_STATE_ACCESS_KEY_ID",
  "SEAWEEDFS_TOFU_STATE_SECRET_ACCESS_KEY",
  "SONARR_API_KEY",
  "TAILSCALE_OAUTH_CLIENT_ID",
  "TAILSCALE_OAUTH_CLIENT_SECRET",
  "TOFU_GITHUB_TOKEN",
  "TURBO_TOKEN",
];

/**
 * Credentials that must never be reachable from a pull request, named
 * individually so the assertion says what it is protecting. Each belongs to a
 * step that publishes, deploys, or mutates infrastructure.
 */
const RELEASE_ONLY_SECRETS = [
  "NPM_TOKEN",
  "CHARTMUSEUM_USERNAME",
  "CHARTMUSEUM_PASSWORD",
  "SEAWEEDFS_SITES_ACCESS_KEY_ID",
  "SEAWEEDFS_SITES_SECRET_ACCESS_KEY",
];

/**
 * Exactly the steps allowed to write a published site or release archive.
 *
 * Closed-world on purpose. Nothing in this repository checks for an
 * *excessive* grant -- `check-ci-env` only reports a step that cannot meet a
 * requirement -- so a step quietly gaining the site-write identity would
 * otherwise pass every check while widening what a build can overwrite.
 */
const SITE_WRITERS = [
  "scout-beta-release",
  "scout-prod-reconcile",
  "scout-tag-release",
  "sites",
];

describe("what a pull request can reach", () => {
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
  test("grants the site-write identity to exactly the deploy steps", () => {
    const holders = allSteps()
      .filter((step) =>
        (step.secrets ?? []).some((grant) =>
          grant.env.startsWith("SEAWEEDFS_SITES_"),
        ),
      )
      .map((step) => step.key)
      .sort();
    expect(holders).toEqual(SITE_WRITERS);
  });

  /**
   * The same credentials must still reach the release chain on a push to the
   * default branch -- otherwise this boundary could be "held" by a selector
   * that quietly stopped selecting anything.
   */
  test("still grants them on a push to the default branch", () => {
    const selected = selectSteps(allSteps(), {
      event: "push",
      branch: "main",
      defaultBranch: "main",
      changedFiles: [],
    });
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
});
