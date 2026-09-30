data "google_billing_account" "llm" {
  billing_account = var.google_billing_account_id
}

# Early warning, not the stop. The hard stop is the Gemini API's per-project
# monthly spend cap, which exists only in AI Studio's Spend tab — there is no
# API for it — so its value lives in `ai_studio_spend_cap_usd` for review and is
# applied by hand. That cap enforces with roughly a ten-minute delay, so this
# budget fires at fractions of the monthly amount and on forecast, to be seen
# before the cap has to do anything.
resource "google_billing_budget" "workload" {
  for_each = var.google_workloads

  billing_account = data.google_billing_account.llm.id
  display_name    = "llm ${each.key}"

  budget_filter {
    projects               = ["projects/${google_project.workload[each.key].number}"]
    calendar_period        = "MONTH"
    credit_types_treatment = "INCLUDE_ALL_CREDITS"
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(each.value.monthly_budget_usd)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }
}
