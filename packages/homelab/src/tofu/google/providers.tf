terraform {
  required_version = ">= 1.9.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.4"
    }
  }
}

# Operator-applied with the operator's own Application Default Credentials
# (`gcloud auth application-default login`), never planned in CI.
#
# Without a Google Cloud organization, only a user account can create
# projects — a service account has nowhere to hold
# `resourcemanager.projects.create` — so a stored bootstrap key could not do
# this stack's main job anyway. Budgets and the IAM APIs also reject user
# credentials that have no quota project, which is what `billing_project`
# provides: an existing project the operator designates once, see the
# credential rotation how-to.
provider "google" {
  billing_project       = var.google_quota_project_id
  user_project_override = true
}
