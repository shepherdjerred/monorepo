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

      # The buildkite/monorepo/pr/* required checks were removed 2026-07 along
      # with the CI pipeline. ci/merge-conflict below is posted by the Temporal
      # worker, not Buildkite, so it survives the CI strip.
      #
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
      # Ships in the same `tofu apply` as the `push` event subscription in
      # webhooks.tf — both gate "ci/merge-conflict" being meaningful.
      required_check {
        context = "ci/merge-conflict"
      }

      # Aggregate Buildkite CI check for the replatformed pipeline. The Buildkite
      # agent stack posts a single rolled-up "buildkite/monorepo" commit status
      # per PR build (build passed/failed), rather than the old per-step
      # buildkite/monorepo/pr/* contexts that were removed 2026-07.
      #
      # LEFT COMMENTED OUT ON PURPOSE — do NOT uncomment + `tofu apply` until the
      # Buildkite pipeline is live and has posted "buildkite/monorepo" on at least
      # one PR build on main. Requiring a context that doesn't yet exist on PR
      # builds blocks EVERY open PR on a missing required check (same rollout
      # hazard called out for ci/merge-conflict above, and in
      # packages/homelab/CLAUDE.md → "GitHub Repo Settings & Rulesets").
      #
      # Uncomment when the pipeline is live:
      # required_check {
      #   context = "buildkite/monorepo"
      # }
    }
  }

  bypass_actors {
    actor_id    = 5
    actor_type  = "RepositoryRole"
    bypass_mode = "always"
  }
}
