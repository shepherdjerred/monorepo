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
        context = "buildkite/monorepo/ci-complete"
      }
    }
  }

  bypass_actors {
    actor_id    = 5
    actor_type  = "RepositoryRole"
    bypass_mode = "always"
  }
}
