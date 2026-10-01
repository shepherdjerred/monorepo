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
