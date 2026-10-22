# The archived OpenRouter key no longer needs managed metadata. Archiving is
# already terminal in Anthropic, and the resource has `prevent_destroy`, so
# OpenTofu forgets the key instead of destroying it. `removed` cannot address a
# for_each instance, hence the intermediate move.
moved {
  from = anthropic_api_key.managed["openrouter"]
  to   = anthropic_api_key.retired_openrouter
}

removed {
  from = anthropic_api_key.retired_openrouter

  lifecycle {
    destroy = false
  }
}
