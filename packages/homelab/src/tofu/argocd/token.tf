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

# The account and its narrow Application permissions are owned by the ArgoCD
# chart. Apply that account registration before creating this token.
resource "argocd_account_token" "delivery" {
  account = "delivery"
}

resource "onepassword_item" "argocd_delivery_token" {
  vault = "v64ocnykdqju4ui6j6pua56xw4"
  title = "delivery-argocd-token"

  section {
    label = "tokens"

    field {
      label = "ARGOCD_TOKEN"
      value = argocd_account_token.delivery.jwt
      type  = "CONCEALED"
    }
  }
}

output "delivery_onepassword_item_id" {
  description = "1Password item UUID for the scoped Delivery ArgoCD token"
  value       = onepassword_item.argocd_delivery_token.uuid
}

resource "argocd_account_token" "delivery_observer" {
  account = "delivery-observer"
}

resource "onepassword_item" "argocd_delivery_observer_token" {
  vault = "v64ocnykdqju4ui6j6pua56xw4"
  title = "delivery-argocd-observer-token"

  section {
    label = "tokens"

    field {
      label = "ARGOCD_RECOVERY_TOKEN"
      value = argocd_account_token.delivery_observer.jwt
      type  = "CONCEALED"
    }
  }
}

output "delivery_observer_onepassword_item_id" {
  description = "1Password item UUID for the read-only Delivery ArgoCD recovery token"
  value       = onepassword_item.argocd_delivery_observer_token.uuid
}
