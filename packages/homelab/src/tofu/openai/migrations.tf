moved {
  from = openai_project.managed["buildkite"]
  to   = openai_project.managed["woodpecker"]
}

moved {
  from = openai_project_spend_alert.managed["buildkite-monthly"]
  to   = openai_project_spend_alert.managed["woodpecker-monthly"]
}

moved {
  from = openai_project_spend_limit.managed["buildkite-monthly"]
  to   = openai_project_spend_limit.managed["woodpecker-monthly"]
}

moved {
  from = openai_project_model_permissions.managed["buildkite"]
  to   = openai_project_model_permissions.managed["woodpecker"]
}

# OpenRouter is retired; inference calls providers directly. Its project was
# archived in the OpenAI dashboard, which is the terminal state a destroy would
# reach, so OpenTofu forgets the project instead of archiving it again.
# `removed` cannot address a for_each instance, hence the intermediate move.
#
# Its BYOK service account left state through `tofu state rm` instead: OpenAI
# rejects every read of a service account in an archived project, and OpenTofu
# refreshes even resources it is only forgetting.
moved {
  from = openai_project.managed["openrouter"]
  to   = openai_project.retired_openrouter
}

removed {
  from = openai_project.retired_openrouter

  lifecycle {
    destroy = false
  }
}

# The Scout beta, Scout voice, and Scout prod projects were archived in the
# OpenAI dashboard, which cannot be undone:
#   scout-beta                proj_W3LLi8mKyuKdJkxou38TpHIR
#   scout-active-2026-09      proj_3I9qDcL4Qvc82676p2g59DjA
#   scout-prod-active-2026-09 proj_CRibw9zX9kDaFnQzynYbKdIm
# Each workload moves to a new project with the same allowlist, spend limit,
# and alert, and a newly dated service account writes the same 1Password
# field. OpenTofu forgets the archived projects and their spend controls
# instead of planning a destroy against them. `removed` cannot address a
# for_each instance and a moved object's old key cannot stay declared, hence
# the intermediate moves and the new keys.
#
# Their service accounts and model allowlists leave state through
# `tofu state rm` instead, as with OpenRouter: OpenAI rejects every read of
# either in an archived project, and OpenTofu refreshes even resources it is
# forgetting. Archived projects and their spend alerts and limits stay
# readable.
moved {
  from = openai_project.managed["scout-beta"]
  to   = openai_project.retired_scout_beta
}

removed {
  from = openai_project.retired_scout_beta

  lifecycle {
    destroy = false
  }
}

moved {
  from = openai_project_spend_alert.managed["scout-beta-monthly"]
  to   = openai_project_spend_alert.retired_scout_beta_monthly
}

removed {
  from = openai_project_spend_alert.retired_scout_beta_monthly

  lifecycle {
    destroy = false
  }
}

moved {
  from = openai_project_spend_limit.managed["scout-beta-monthly"]
  to   = openai_project_spend_limit.retired_scout_beta_monthly
}

removed {
  from = openai_project_spend_limit.retired_scout_beta_monthly

  lifecycle {
    destroy = false
  }
}

moved {
  from = openai_project.managed["scout-active-2026-09"]
  to   = openai_project.retired_scout_active_2026_09
}

removed {
  from = openai_project.retired_scout_active_2026_09

  lifecycle {
    destroy = false
  }
}

moved {
  from = openai_project_spend_alert.managed["scout-monthly"]
  to   = openai_project_spend_alert.retired_scout_monthly
}

removed {
  from = openai_project_spend_alert.retired_scout_monthly

  lifecycle {
    destroy = false
  }
}

moved {
  from = openai_project_spend_limit.managed["scout-active-monthly-2026-09"]
  to   = openai_project_spend_limit.retired_scout_active_monthly_2026_09
}

removed {
  from = openai_project_spend_limit.retired_scout_active_monthly_2026_09

  lifecycle {
    destroy = false
  }
}

moved {
  from = openai_project.managed["scout-prod-active-2026-09"]
  to   = openai_project.retired_scout_prod_active_2026_09
}

removed {
  from = openai_project.retired_scout_prod_active_2026_09

  lifecycle {
    destroy = false
  }
}

moved {
  from = openai_project_spend_alert.managed["scout-prod-monthly"]
  to   = openai_project_spend_alert.retired_scout_prod_monthly
}

removed {
  from = openai_project_spend_alert.retired_scout_prod_monthly

  lifecycle {
    destroy = false
  }
}

moved {
  from = openai_project_spend_limit.managed["scout-prod-monthly"]
  to   = openai_project_spend_limit.retired_scout_prod_monthly
}

removed {
  from = openai_project_spend_limit.retired_scout_prod_monthly

  lifecycle {
    destroy = false
  }
}
