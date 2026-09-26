# One service-account-bound Gemini API key per workload, restricted to the
# Gemini API. The key string lands in this stack's encrypted state and in the
# workload's own 1Password item, which the cluster syncs as GEMINI_API_KEY.
#
# Rotation is a reviewed change: bump gemini_key_revision. The key name
# changes, so OpenTofu mints and hands off the replacement before deleting the
# old key, and a pod restart picks up the new value.
resource "google_apikeys_key" "gemini" {
  for_each = var.google_workloads

  project               = google_project.workload[each.key].project_id
  name                  = "gemini-${each.key}-r${each.value.gemini_key_revision}"
  display_name          = "Gemini API key for ${each.key} (revision ${each.value.gemini_key_revision})"
  service_account_email = google_service_account.gemini_key[each.key].email

  restrictions {
    api_targets {
      service = "generativelanguage.googleapis.com"
    }
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [google_project_service.workload]
}

resource "onepassword_item" "gemini" {
  for_each = var.google_workloads

  # The "Homelab (Kubernetes)" vault, which the cluster's 1Password operator syncs.
  vault    = "v64ocnykdqju4ui6j6pua56xw4"
  title    = each.value.onepassword_item_title
  category = "secure_note"

  section {
    label = "credentials"

    field {
      label = "GEMINI_API_KEY"
      type  = "CONCEALED"
      value = google_apikeys_key.gemini[each.key].key_string
    }
  }
}
