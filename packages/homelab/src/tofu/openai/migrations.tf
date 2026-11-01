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

# The Scout beta project (proj_W3LLi8mKyuKdJkxou38TpHIR) was archived in the
# OpenAI dashboard, which cannot be undone, so Scout beta moves to
# scout-beta-active-2026-09 with the same allowlist, spend limit, and alert,
# and a newly dated service account writes the same 1Password field. OpenTofu
# forgets the archived project and its controls instead of planning a destroy
# against it. `removed` cannot address a for_each instance and a moved object's
# old key cannot stay declared, hence the intermediate moves and the new keys.
#
# Its scout-beta-2026-09 service account leaves state through `tofu state rm`
# instead, as with OpenRouter: OpenAI rejects every read of a service account in
# an archived project, and OpenTofu refreshes even resources it is forgetting.
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
  from = openai_project_model_permissions.managed["scout-beta"]
  to   = openai_project_model_permissions.retired_scout_beta
}

removed {
  from = openai_project_model_permissions.retired_scout_beta

  lifecycle {
    destroy = false
  }
}
