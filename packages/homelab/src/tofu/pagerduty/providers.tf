terraform {
  required_version = ">= 1.6.0"

  required_providers {
    pagerduty = {
      source  = "PagerDuty/pagerduty"
      version = "~> 3.0"
    }
  }
}

# Token is supplied via TF_VAR_pagerduty_token rather than the provider's default
# PAGERDUTY_TOKEN env var, because PAGERDUTY_TOKEN is already used elsewhere for
# the unrelated Events-v2 routing key that Alertmanager consumes.
provider "pagerduty" {
  token = var.pagerduty_token
}
