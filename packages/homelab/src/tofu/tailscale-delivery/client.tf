# Apply the ACL stack's reviewed tag:delivery ownership before provisioning.
# This client can register only Delivery nodes: no ACL, device-management, or
# OAuth-client-management capability is handed to the workload.
resource "tailscale_oauth_client" "delivery" {
  description = "Delivery browser identity proxy"
  scopes      = ["auth_keys"]
  tags        = ["tag:delivery"]

  lifecycle {
    prevent_destroy = true
  }
}

resource "onepassword_item" "delivery_tailscale" {
  vault    = "v64ocnykdqju4ui6j6pua56xw4"
  title    = "delivery-tailscale-oauth"
  category = "secure_note"

  section {
    label = "credentials"

    field {
      label = "TS_AUTHKEY"
      type  = "CONCEALED"
      # Official containerboot supports OAuth secrets with this parameter.
      # Persisted node state plus TS_AUTH_ONCE avoids creating nodes on restart.
      value = "${tailscale_oauth_client.delivery.key}?ephemeral=false"
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

output "delivery_onepassword_item_id" {
  description = "Nonsecret UUID to activate the Delivery Tailscale sidecar's secret reference."
  value       = onepassword_item.delivery_tailscale.uuid
}
