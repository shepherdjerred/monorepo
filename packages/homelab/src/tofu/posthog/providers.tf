terraform {
  required_version = ">= 1.12.0"

  required_providers {
    posthog = {
      source  = "PostHog/posthog"
      version = "~> 1.0"
    }
  }
}

provider "posthog" {
  organization_id = local.organization_id
  project_id      = local.project_id
}
