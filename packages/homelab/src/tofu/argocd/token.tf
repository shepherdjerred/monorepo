# The retired Woodpecker token/item are intentionally absent. Apply only after
# the reviewed scoped accounts exist; inspect their planned destruction during
# the clean cutover, before removing the legacy account from the final chart.
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

# Apply the reviewed delivery-platform account/RBAC before this operator-owned
# stack. This is a new account token, never a copy of the legacy CI credential.
resource "argocd_account_token" "delivery_platform" {
  account = "delivery-platform"
}

resource "onepassword_item" "argocd_delivery_platform_token" {
  vault = "v64ocnykdqju4ui6j6pua56xw4"
  title = "delivery-argocd-platform-token"

  section {
    label = "tokens"
    field {
      label = "ARGOCD_TOKEN"
      value = argocd_account_token.delivery_platform.jwt
      type  = "CONCEALED"
    }
  }
}

output "delivery_platform_onepassword_item_id" {
  description = "Issued dedicated platform ArgoCD item; register as platformArgocd before enabling platform execution"
  value       = onepassword_item.argocd_delivery_platform_token.uuid
}

# The operator tool's account for operator-run Applications (cluster-admission
# and the data layers). The ArgoCD chart defines it with no grant before the
# Delivery v2 window, so this token may be issued at any time. Only operators
# read the item; nothing in the cluster mounts it.
resource "argocd_account_token" "operator_run" {
  account = "operator-run"
}

resource "onepassword_item" "argocd_operator_run_token" {
  vault = "v64ocnykdqju4ui6j6pua56xw4"
  title = "delivery-argocd-operator-run-token"

  section {
    label = "tokens"

    field {
      label = "ARGOCD_TOKEN"
      value = argocd_account_token.operator_run.jwt
      type  = "CONCEALED"
    }
  }
}

output "operator_run_onepassword_item_id" {
  description = "1Password item UUID for the operator tool's ArgoCD token for operator-run Applications"
  value       = onepassword_item.argocd_operator_run_token.uuid
}

# The read-only API account agent workstations use through toolkit. The
# ArgoCD chart registers it with `role:readonly` and no login; apply that
# registration before creating this token. Workstations read the item; nothing
# in the cluster mounts it.
resource "argocd_account_token" "workstation" {
  account = "workstation"
}

resource "onepassword_item" "argocd_workstation_token" {
  vault = "v64ocnykdqju4ui6j6pua56xw4"
  title = "argocd-workstation-token"

  section {
    label = "tokens"

    field {
      label = "ARGOCD_AUTH_TOKEN"
      value = argocd_account_token.workstation.jwt
      type  = "CONCEALED"
    }
  }
}

output "workstation_onepassword_item_id" {
  description = "1Password item UUID for the read-only workstation ArgoCD token toolkit uses"
  value       = onepassword_item.argocd_workstation_token.uuid
}

# The read-only API account the Temporal homelab audit uses through
# `toolkit argocd`. Register it in the ArgoCD chart before creating this token.
# The temporal worker's 1Password operator item projects the field as
# ARGOCD_AUTH_TOKEN.
resource "argocd_account_token" "homelab_audit" {
  account = "homelab-audit"
}

resource "onepassword_item" "argocd_homelab_audit_token" {
  vault = "v64ocnykdqju4ui6j6pua56xw4"
  title = "argocd-homelab-audit-token"

  section {
    label = "tokens"

    field {
      label = "ARGOCD_AUTH_TOKEN"
      value = argocd_account_token.homelab_audit.jwt
      type  = "CONCEALED"
    }
  }
}

output "homelab_audit_onepassword_item_id" {
  description = "1Password item UUID for the read-only homelab-audit ArgoCD token"
  value       = onepassword_item.argocd_homelab_audit_token.uuid
}
