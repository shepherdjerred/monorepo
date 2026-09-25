# Hard per-model request ceilings for each workload's Gemini project.
#
# The AI Studio spend cap is the monthly dollar stop, but it has no API and
# lags about ten minutes. These quotas apply immediately and live in code: the
# per-minute limit throttles a runaway loop, and an optional per-day limit
# bounds a single day.
#
# Google rejects a decrease of more than 10% unless the request ignores both
# the below-usage and the percentage safety check, and this resource can
# ignore only one. A large per-day decrease therefore needs a one-time Cloud
# Quotas API call followed by an import; increases apply normally.
#
# The `model` dimension uses Cloud Quotas names, which can differ from the API
# model id (gemini-3-pro-image-preview is metered as gemini-3-pro-image).
locals {
  gemini_quota_limits = merge([
    for workload, config in var.google_workloads : merge([
      for model, limit in config.gemini_quota_limits : merge(
        limit.requests_per_day == null ? {} : {
          "${workload}/${model}/day" = {
            workload = workload
            model    = model
            quota_id = "GenerateRequestsPerDayPerProjectPerModel"
            value    = limit.requests_per_day
          }
        },
        {
          "${workload}/${model}/minute" = {
            workload = workload
            model    = model
            quota_id = "GenerateRequestsPerMinutePerProjectPerModel"
            value    = limit.requests_per_minute
          }
        },
      )
    ]...)
  ]...)
}

resource "google_cloud_quotas_quota_preference" "gemini" {
  for_each = local.gemini_quota_limits

  parent        = "projects/${google_project.workload[each.value.workload].project_id}"
  service       = "generativelanguage.googleapis.com"
  quota_id      = each.value.quota_id
  dimensions    = { model = each.value.model }
  justification = "Runaway guard for ${each.value.workload}: bounds worst-case daily Gemini spend"

  # The below-usage check cannot read usage for a project that has never
  # called the API, and these projects' limits are set before first use, so
  # current usage is zero by construction.
  ignore_safety_checks = "QUOTA_DECREASE_BELOW_USAGE"

  quota_config {
    preferred_value = tostring(each.value.value)
  }

  depends_on = [google_project_service.workload]
}
