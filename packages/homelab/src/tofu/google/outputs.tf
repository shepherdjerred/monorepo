# Everything the key-minting step needs. Not secrets: the key is minted and
# handed to 1Password by the operator, and never passes through OpenTofu.
output "google_gemini_key_targets" {
  description = "Per-workload project, key identity, cap, and 1Password target for the Gemini key handoff"
  value = {
    for key, project in google_project.workload : key => {
      project_id              = project.project_id
      service_account_email   = google_service_account.gemini_key[key].email
      ai_studio_spend_cap_usd = var.google_workloads[key].ai_studio_spend_cap_usd
      onepassword_targets     = var.google_workloads[key].onepassword_targets
    }
  }
}
