data "anthropic_organization" "current" {}

resource "anthropic_workspace" "managed" {
  for_each = var.anthropic_federation_workspaces

  name = each.value.name
}

# Anthropic cannot reach the cluster's issuer, so the signing keys are uploaded
# inline and the issuer URL is only string-compared against each token's `iss`.
# Rotating the cluster's service-account signing key breaks every federated
# workload until this key set is re-applied; see the credential rotation how-to.
resource "anthropic_federation_issuer" "cluster" {
  name       = var.anthropic_federation_issuer.name
  issuer_url = var.anthropic_federation_issuer.issuer_url
  jwks = {
    type = "inline"
    keys = var.anthropic_federation_issuer.jwks_keys_json
  }
  max_jwt_lifetime_seconds = var.anthropic_federation_issuer.max_jwt_lifetime_seconds
  # Replay protection stays on. The runtime re-reads the projected token on every
  # exchange and the kubelet rotates it well inside the minted token's lifetime,
  # so disabling this would only hide a misconfiguration.
  check_jti = true
}

resource "anthropic_service_account" "workload" {
  for_each = var.anthropic_federation_workloads

  name        = each.key
  description = "Federated identity for ${each.key}; tokens minted from the ${each.value.namespace} namespace's projected service-account tokens"
}

resource "anthropic_service_account_workspace" "workload" {
  for_each = var.anthropic_federation_workloads

  service_account_id = anthropic_service_account.workload[each.key].id
  workspace_id       = anthropic_workspace.managed[each.value.workspace_key].id
  workspace_role     = "workspace_developer"
}

resource "anthropic_federation_rule" "workload" {
  for_each = var.anthropic_federation_workloads

  name        = each.key
  description = "Pods in ${each.value.namespace} that mount a projected token for Anthropic"
  issuer_id   = anthropic_federation_issuer.cluster.id

  # Each namespace is exactly one app and environment, and only pods that
  # explicitly mount the Anthropic-audience projected token can present one, so
  # matching the namespace scopes the rule without a per-pod service account.
  match = {
    subject_prefix = "system:serviceaccount:${each.value.namespace}:*"
  }
  target = {
    service_account_id = anthropic_service_account.workload[each.key].id
  }

  # Inference only: these workloads call models and nothing else.
  oauth_scope            = "workspace:inference"
  workspace_id           = anthropic_workspace.managed[each.value.workspace_key].id
  token_lifetime_seconds = each.value.token_lifetime_seconds

  depends_on = [anthropic_service_account_workspace.workload]
}

# Not secrets: a token can only be minted by presenting a JWT from the trusted
# issuer whose claims match the rule. `scripts/tofu/export-workload-identity.ts`
# copies these into the CDK8s workload-identity inventory.
output "anthropic_workload_identity" {
  description = "Per-workload federation identifiers for the CDK8s workload-identity inventory"
  value = {
    organization_id = data.anthropic_organization.current.id
    workloads = {
      for key, rule in anthropic_federation_rule.workload : key => {
        federation_rule_id = rule.id
        service_account_id = anthropic_service_account.workload[key].id
        workspace_id       = anthropic_workspace.managed[var.anthropic_federation_workloads[key].workspace_key].id
      }
    }
  }
}
