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
    }
  }

  bypass_actors {
    actor_id    = 5
    actor_type  = "RepositoryRole"
    bypass_mode = "always"
  }
}
