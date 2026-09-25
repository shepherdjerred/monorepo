# What still needs a person: the AI Studio spend cap has no API. Not secrets.
output "google_gemini_spend_caps" {
  description = "Per-workload project and the AI Studio spend cap to set by hand"
  value = {
    for key, project in google_project.workload : key => {
      project_id              = project.project_id
      ai_studio_spend_cap_usd = var.google_workloads[key].ai_studio_spend_cap_usd
      onepassword_item_title  = onepassword_item.gemini[key].title
    }
  }
}
