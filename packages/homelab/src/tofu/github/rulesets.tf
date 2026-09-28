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

      # ci/merge-conflict is posted by the Temporal worker rather than by CI,
      # which is why it survived the move off Buildkite untouched.
      #
      # ci/merge-conflict: locally-computed merge-tree result against main,
      # posted by packages/temporal/src/activities/maintenance/check-pr-merge-conflicts.ts
      # whenever main moves (singleton workflow) or a PR head moves
      # (per-PR workflow). The activity NEVER reads GitHub's `mergeable`
      # field — local 3-way merge is deterministic; GitHub's lazy field is
      # not.
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

      # The generated ci-complete workflow waits for every selected blocking
      # PR workflow and verifies their statuses belong to that exact pipeline.
      #
      # ROLLOUT ORDERING — do NOT `tofu apply` this context until a Woodpecker
      # pipeline has actually run on a PR head and posted it. Requiring a
      # context nothing posts blocks every open PR on a missing check, which is
      # the same trap the merge-conflict note above describes.
      #
      # Apply only after this context passes on a real post-bootstrap PR head.
      # The one-time premerge bypass apply overrides this variable with the old
      # Buildkite context, leaving the required check unchanged.
      required_check {
        context = var.required_ci_status_context
      }
    }
  }

  # A repository admin can merge a reviewed PR during a CI control-plane
  # bootstrap without gaining an exemption for direct pushes.
  bypass_actors {
    actor_id    = 5
    actor_type  = "RepositoryRole"
    bypass_mode = "pull_request"
  }
}
