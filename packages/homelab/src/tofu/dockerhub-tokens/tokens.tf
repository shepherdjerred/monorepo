locals {
  tokens = {
    management = {
      scopes = ["repo:read", "repo:write", "repo:admin"]
    }
    publisher = {
      scopes = ["repo:read", "repo:write"]
    }
    reader = {
      scopes = ["repo:read"]
    }
    renovate = {
      scopes = ["repo:read"]
    }
  }
}

# The account API read both proves token-management access and initializes the
# provider's cached account username before docker_login reads it.
data "docker_access_tokens" "account" {}

data "docker_login" "operator" {
  depends_on = [data.docker_access_tokens.account]
}

resource "docker_access_token" "automation" {
  for_each = local.tokens

  token_label = "homelab-${each.key}"
  scopes      = each.value.scopes

  lifecycle {
    prevent_destroy = true

    precondition {
      condition     = data.docker_login.operator.username == "shepherdjerred"
      error_message = "Sign into Docker Desktop as shepherdjerred before managing homelab tokens."
    }
  }
}

output "credentials" {
  description = "In-memory handoff to separate 1Password items; never print or save the decrypted output."
  sensitive   = true
  value = {
    for purpose, token in docker_access_token.automation : purpose => {
      username = data.docker_login.operator.username
      token    = token.token
      uuid     = token.uuid
    }
  }
}
