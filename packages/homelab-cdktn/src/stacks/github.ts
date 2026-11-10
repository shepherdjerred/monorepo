import type { Construct } from "constructs";
import { Fn, Op, TerraformVariable } from "cdktn";
import { GithubProvider } from "#generated/providers/github/provider/index.ts";
import { Repository } from "#generated/providers/github/repository/index.ts";
import { RepositoryRuleset } from "#generated/providers/github/repository-ruleset/index.ts";
import { RepositoryWebhook } from "#generated/providers/github/repository-webhook/index.ts";
import { HomelabStack } from "#src/homelab-stack.ts";

const TOKEN_PREFIXES = ["github_pat_", "ghp_", "ghs_", "ghu_"];
const CI_STATUS_CONTEXT = "ci/woodpecker/pr/ci-complete";

/** Repository settings, the `main` ruleset and the pr-bot webhook. */
export class GithubStack extends HomelabStack {
  constructor(scope: Construct) {
    super(scope, "github", {
      requiredVersion: ">= 1.6.0",
      providerConstraints: { github: "~> 6.12" },
    });

    const token = new TerraformVariable(this, "github_token", {
      description:
        "GitHub token used by the GitHub provider for repository and ruleset management",
      type: "string",
      sensitive: true,
    });
    // A validation refers to its own variable, so it is added once the
    // variable exists: a raw "${var.…}" string passed to Fn is escaped.
    token.addValidation({
      condition: Fn.anytrue(
        TOKEN_PREFIXES.map((prefix) =>
          Fn.startswith(token.stringValue, prefix),
        ),
      ),
      errorMessage:
        "github_token must be a GitHub fine-grained PAT (github_pat_), classic PAT (ghp_), GitHub App installation token (ghs_), or GitHub App user token (ghu_).",
    });

    const requiredCiStatusContext = new TerraformVariable(
      this,
      "required_ci_status_context",
      {
        description: "Required Woodpecker PR CI completion context",
        type: "string",
        default: CI_STATUS_CONTEXT,
      },
    );
    requiredCiStatusContext.addValidation({
      condition: Op.eq(requiredCiStatusContext.stringValue, CI_STATUS_CONTEXT),
      errorMessage:
        "required_ci_status_context must be the Woodpecker CI completion context.",
    });

    new GithubProvider(this, "github", {
      owner: "shepherdjerred",
      token: token.stringValue,
    });

    const monorepo = new Repository(this, "monorepo", {
      name: "monorepo",
      description: "Monorepo for all of my projects",
      visibility: "public",
      hasIssues: true,
      hasProjects: false,
      hasWiki: false,
      deleteBranchOnMerge: true,
      allowAutoMerge: true,
      allowUpdateBranch: true,
      allowSquashMerge: true,
      allowMergeCommit: false,
      allowRebaseMerge: false,
      squashMergeCommitTitle: "PR_TITLE",
      squashMergeCommitMessage: "COMMIT_MESSAGES",
    });

    new Repository(this, "shepherdjerred", {
      name: "shepherdjerred",
      description: "My profile README",
      visibility: "public",
      hasIssues: true,
      hasProjects: false,
      hasWiki: false,
      deleteBranchOnMerge: true,
      allowAutoMerge: true,
      allowUpdateBranch: true,
      allowSquashMerge: false,
      allowMergeCommit: true,
      allowRebaseMerge: true,
    });

    this.addMainRuleset(monorepo, requiredCiStatusContext.stringValue);
    this.addWebhooks(monorepo);
  }

  /**
   * Branch protection is a ruleset rather than `github_branch_protection`:
   * the old resource used GraphQL and hung on refresh; rulesets use REST.
   */
  private addMainRuleset(monorepo: Repository, ciStatusContext: string): void {
    const ruleset = new RepositoryRuleset(this, "monorepo_main", {
      name: "main",
      repository: monorepo.name,
      target: "branch",
      enforcement: "active",
      conditions: {
        refName: { include: ["~DEFAULT_BRANCH"], exclude: [] },
      },
      rules: {
        deletion: true,
        nonFastForward: true,
        requiredLinearHistory: true,
        requiredStatusChecks: {
          strictRequiredStatusChecksPolicy: false,
          requiredCheck: [
            // ci/merge-conflict is posted by the Temporal worker rather than
            // by CI: a locally-computed merge-tree result against main, from
            // packages/temporal/src/activities/maintenance/check-pr-merge-conflicts.ts
            // whenever main moves (singleton workflow) or a PR head moves
            // (per-PR workflow). The activity NEVER reads GitHub's
            // `mergeable` field: a local 3-way merge is deterministic and
            // GitHub's lazy field is not.
            //
            // ROLLOUT ORDERING: do NOT apply this entry until BOTH
            //   (1) the temporal worker pod is running the merge-conflict
            //       activity, and
            //   (2) a one-off `kind: "all-prs"` workflow run has backfilled
            //       statuses on every currently-open PR.
            // Applying earlier blocks every open PR on a missing required
            // check. Ships in the same apply as the `push` event
            // subscription of the pr-bot webhook below.
            { context: "ci/merge-conflict" },
            // The generated ci-complete workflow waits for every selected
            // blocking PR workflow and verifies their statuses belong to
            // that exact pipeline.
            //
            // ROLLOUT ORDERING: do NOT apply a new context until a
            // Woodpecker pipeline has actually run on a PR head and posted
            // it. Requiring a context nothing posts blocks every open PR on
            // a missing check.
            { context: ciStatusContext },
          ],
        },
      },
      // A repository admin can merge a reviewed PR during a CI control-plane
      // bootstrap without gaining an exemption for direct pushes.
      bypassActors: [
        { actorId: 5, actorType: "RepositoryRole", bypassMode: "pull_request" },
      ],
    });
    ruleset.importFrom("monorepo:11098884");
  }

  /**
   * Repository webhooks for shepherdjerred/monorepo.
   *
   * INCIDENT (2026-07-31): the pre-existing hooks were adopted with an
   * import, which fills state's `configuration.secret` from a GitHub read,
   * and GitHub ALWAYS answers with the masked placeholder "********". With
   * `ignore_changes = [configuration[0].secret]` the diff was hidden, but
   * the placeholder was still resent in the full `configuration` payload
   * whenever any other attribute changed. PR #1863 changed pr_bot's
   * `events`; the apply wrote the literal "********" as the real secret and
   * silently broke the live webhook's HMAC verification for about a day.
   *
   * Neither secret is knowable here (they are owned by the receiving end),
   * so the webhook is frozen with `ignore_changes = all`: no apply may send
   * any attribute of it again.
   */
  private addWebhooks(monorepo: Repository): void {
    // CI moved to Woodpecker, which registers its own webhook when a
    // repository is activated. `removed` rather than a deletion keeps the
    // old Buildkite address out of state without touching GitHub.
    this.removeFromState("github_repository_webhook.buildkite");

    // Feeds the temporal worker's GitHub event bridge
    // (packages/temporal/src/event-bridge/github-webhook.ts). The HMAC
    // secret on both ends is GITHUB_WEBHOOK_SECRET from 1Password.
    //
    // ROLLOUT ORDERING: the `push` event ships the ci/merge-conflict check;
    // same constraint as the required check in the ruleset above.
    const prBot = new RepositoryWebhook(this, "pr_bot", {
      repository: monorepo.name,
      configuration: {
        url: "https://pr-bot.sjer.red/webhook",
        contentType: "json",
        insecureSsl: false,
      },
      active: true,
      // `push` drives the main-branch merge-conflict backfill and
      // `pull_request` drives the per-PR merge-conflict check.
      events: ["pull_request", "push"],
      lifecycle: {
        // BREAK-GLASS: state holds the masked placeholder "********"
        // captured at import, and GitHub accepts that literal string as a
        // real secret write. See the incident note above.
        ignoreChanges: "all",
      },
    });
    prBot.importFrom("monorepo/616025071");
  }
}
