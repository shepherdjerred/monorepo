# Managed PagerDuty on-call config, imported from the live account via OpenTofu
# import blocks + `-generate-config-out`, then verified zero-change. The Events-v2
# integration's routing key (integration_key) is a read-only attribute preserved
# on import, so the key Alertmanager consumes (1Password "AlertManager secrets"
# / PAGERDUTY_TOKEN) is unchanged.

# __generated__ by OpenTofu
# Please review these resources and move them into your main configuration files.

# __generated__ by OpenTofu from "P9G2DKV"
resource "pagerduty_escalation_policy" "default" {
  description = ""
  name        = "Default"
  num_loops   = 0
  teams       = []
  rule {
    escalation_delay_in_minutes = 30
    escalation_rule_assignment_strategy {
      type = "assign_to_everyone"
    }
    target {
      id   = "PDWQ8LR"
      type = "user_reference"
    }
  }
}

# __generated__ by OpenTofu from "PFY32VT.PGC04TT"
resource "pagerduty_service_integration" "homelab_events_v2" {
  email_filter_mode       = null
  email_incident_creation = null
  email_parsing_fallback  = null
  integration_email       = null
  # integration_key is a read-only attribute (the Events-v2 routing key) — never
  # set it in config: it's deprecated as an input and committing it would leak
  # the routing key. It is preserved in state from the import.
  name    = "Events API V2"
  service = "PFY32VT"
  type    = "events_api_v2_inbound_integration"
  vendor  = null
}

# __generated__ by OpenTofu from "PFY32VT"
resource "pagerduty_service" "homelab" {
  acknowledgement_timeout = "null"
  alert_creation          = "create_alerts_and_incidents"
  auto_resolve_timeout    = "null"
  description             = ""
  escalation_policy       = "P9G2DKV"
  name                    = "Homelab"
  response_play           = null
  incident_urgency_rule {
    type    = "constant"
    urgency = "high"
  }
}

# __generated__ by OpenTofu from "PDWQ8LR"
resource "pagerduty_user" "jerred" {
  color       = "purple"
  description = ""
  email       = "pagerduty@sjer.red"
  job_title   = ""
  license     = "PEMHWX5"
  name        = "Jerred Shepherd"
  role        = "owner"
  time_zone   = "America/Los_Angeles"
}
