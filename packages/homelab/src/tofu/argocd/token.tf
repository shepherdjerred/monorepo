resource "argocd_account_token" "buildkite" {
  account = "buildkite"
}

resource "onepassword_item" "argocd_buildkite_token" {
  vault = "v64ocnykdqju4ui6j6pua56xw4"
  title = "buildkite-argocd-token"

  section {
    label = "tokens"

    field {
      label = "ARGOCD_TOKEN"
      value = argocd_account_token.buildkite.jwt
      type  = "CONCEALED"
    }
  }
}

output "onepassword_item_id" {
  description = "1Password item UUID for the ArgoCD buildkite token"
  value       = onepassword_item.argocd_buildkite_token.uuid
}
