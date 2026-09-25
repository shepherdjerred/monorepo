locals {
  project_services = toset([
    "apikeys.googleapis.com",
    "generativelanguage.googleapis.com",
  ])

  workload_services = {
    for pair in setproduct(keys(var.google_workloads), local.project_services) :
    "${pair[0]}/${pair[1]}" => { workload = pair[0], service = pair[1] }
  }
}

# One project per app and environment. The Gemini API meters, caps, and bills
# per project, so this is the unit a runaway can be seen and stopped at.
resource "google_project" "workload" {
  for_each = var.google_workloads

  project_id      = each.value.project_id
  name            = each.value.display_name
  billing_account = var.google_billing_account_id
  deletion_policy = "PREVENT"
}

resource "google_project_service" "workload" {
  for_each = local.workload_services

  project            = google_project.workload[each.value.workload].project_id
  service            = each.value.service
  disable_on_destroy = false
}

# The identity an authorization key is bound to. Gemini API requests made with
# the key are processed as this account, which is what lets a leaked key be
# disabled by disabling one account. The Gemini API is allowed for
# authorization keys by default, so the account needs no project role.
resource "google_service_account" "gemini_key" {
  for_each = var.google_workloads

  project      = google_project.workload[each.key].project_id
  account_id   = "gemini-auth-key"
  display_name = "Gemini API authorization key for ${each.key}"

  depends_on = [google_project_service.workload]
}
