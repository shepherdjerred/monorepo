import {
  to = github_repository_ruleset.monorepo_main
  id = "monorepo:11098884"
}

resource "github_repository_ruleset" "monorepo_main" {
  name        = "main"
  repository  = github_repository.monorepo.name
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]
      exclude = []
    }
  }

  rules {
    deletion                = true
    non_fast_forward        = true
    required_linear_history = true

    required_status_checks {
      strict_required_status_checks_policy = false

      required_check {
        context = "buildkite/monorepo/pr/white-check-mark-ci-complete"
      }

      # Greptile review gate: green only once Greptile has reviewed the head
      # commit and every P3-or-more-severe Greptile comment is resolved
      # (scripts/ci/src/wait-for-greptile.ts). ci-complete already depends on
      # this step, so this is an explicit belt-and-suspenders requirement.
      required_check {
        context = "buildkite/monorepo/pr/mag-greptile-review"
      }

      # ci/merge-conflict: locally-computed merge-tree result against main,
      # posted by packages/temporal/src/activities/check-pr-merge-conflicts.ts
      # whenever main moves (singleton workflow) or a PR head moves
      # (per-PR workflow). The activity NEVER reads GitHub's `mergeable`
      # field — local 3-way merge is deterministic; GitHub's lazy field is
      # not. See packages/docs/plans/2026-06-14_pr-merge-conflict-check.md.
      #
      # ROLLOUT ORDERING — do NOT `tofu apply` this line until BOTH:
      #   (1) the temporal worker pod is running the merge-conflict activity
      #       (i.e. this feature's PR has merged and ArgoCD has rolled out),
      #       and
      #   (2) a one-off `kind: "all-prs"` workflow run has been kicked off in
      #       Temporal to backfill statuses on every currently-open PR.
      # Applying earlier blocks every open PR on a missing required check.
      required_check {
        context = "ci/merge-conflict"
      }
    }
  }

  bypass_actors {
    actor_id    = 5
    actor_type  = "RepositoryRole"
    bypass_mode = "always"
  }
}
