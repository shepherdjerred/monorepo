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
