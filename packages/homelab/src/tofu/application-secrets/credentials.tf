locals {
  credentials = jsondecode(file("${path.module}/desired-state.json")).credentials
}

# Import defaults must match random_password's imported state. Revision zero
# preserves any existing character recipe; later revisions explicitly rotate.
resource "random_password" "credentials" {
  for_each = local.credentials

  length  = each.value.revision == 0 ? lookup(var.adoption_lengths, each.key, 64) : 64
  upper   = each.value.revision == 0
  lower   = true
  numeric = true
  special = each.value.revision == 0

  min_lower   = each.value.revision == 0 ? 0 : 1
  min_numeric = each.value.revision == 0 ? 0 : 1
  keepers     = each.value.revision == 0 ? null : { revision = tostring(each.value.revision) }

  lifecycle {
    precondition {
      condition     = each.value.revision > 0 || contains(keys(var.adoption_lengths), each.key)
      error_message = "Revision zero requires verified adoption lengths; do not generate replacements during adoption."
    }
  }
}

import {
  for_each = var.adoption_keys
  to       = random_password.credentials[each.key]
  # OpenTofu rejects sensitive import IDs. The future operator path must
  # capture all diagnostics and use encrypted plans; the live wrapper is
  # deliberately disabled. Never run this import with inherited stdout.
  id = nonsensitive(var.adoption_values[each.key])
}

output "application_secret_handoffs" {
  description = "Sensitive operator handoffs; the stack has no 1Password write provider."
  sensitive   = true
  value = {
    for key, credential in local.credentials : key => {
      value               = random_password.credentials[key].result
      revision            = credential.revision
      onepassword_targets = credential.onepassword_targets
    }
  }
}
