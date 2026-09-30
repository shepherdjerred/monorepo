moved {
  from = argocd_account_token.buildkite
  to   = argocd_account_token.woodpecker
}

moved {
  from = onepassword_item.argocd_buildkite_token
  to   = onepassword_item.argocd_woodpecker_token
}

resource "argocd_account_token" "woodpecker" {
  account = "woodpecker"
}

resource "onepassword_item" "argocd_woodpecker_token" {
  vault = "v64ocnykdqju4ui6j6pua56xw4"
  title = "woodpecker-argocd-token"

  section {
    label = "tokens"

    field {
      label = "ARGOCD_AUTH_TOKEN"
      value = argocd_account_token.woodpecker.jwt
      type  = "CONCEALED"
    }
  }
}

output "onepassword_item_id" {
  description = "1Password item UUID for the ArgoCD woodpecker token"
  value       = onepassword_item.argocd_woodpecker_token.uuid
}
