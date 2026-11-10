import type { Construct } from "constructs";
import { TerraformIterator, TerraformVariable, Token } from "cdktn";
import { AnthropicProvider } from "#generated/providers/anthropic/provider/index.ts";
import { DataAnthropicOrganization } from "#generated/providers/anthropic/data-anthropic-organization/index.ts";
import { FederationIssuer } from "#generated/providers/anthropic/federation-issuer/index.ts";
import { FederationRule } from "#generated/providers/anthropic/federation-rule/index.ts";
import { ServiceAccount } from "#generated/providers/anthropic/service-account/index.ts";
import { ServiceAccountWorkspace } from "#generated/providers/anthropic/service-account-workspace/index.ts";
import { Workspace } from "#generated/providers/anthropic/workspace/index.ts";
import { Item } from "#generated/providers/onepassword/item/index.ts";
import { OnepasswordProvider } from "#generated/providers/onepassword/provider/index.ts";
import { HomelabStack } from "#src/homelab-stack.ts";
import { HOMELAB_VAULT_ID } from "#src/onepassword.ts";
import { encryptState } from "#src/state-encryption.ts";

/**
 * Anthropic workload identity federation: the cluster's token issuer, and
 * one service account and federation rule per workload. Operator-only: see
 * the provider note below and `src/tofu/README.md`. The values come from the
 * stack's `desired-state.json`, which the stack runner injects as variables.
 */
export class AnthropicFederationStack extends HomelabStack {
  constructor(scope: Construct) {
    super(scope, "anthropic-federation", {
      requiredVersion: ">= 1.9.0",
      providerConstraints: { anthropic: "1.60.0", onepassword: "~> 3.0" },
    });
    encryptState(this);

    const workspaces = new TerraformVariable(
      this,
      "anthropic_federation_workspaces",
      {
        description:
          "One workspace per environment, so usage, cost, and rate limits attribute per environment",
        type: "map(object({ name = string }))",
        default: {},
      },
    );

    new TerraformVariable(this, "anthropic_federation_issuer", {
      description:
        "The cluster's service-account token issuer, trusted by inline JWKS because it is not publicly reachable",
      type: "object({ name = string, issuer_url = string, jwks_keys_json = string, max_jwt_lifetime_seconds = number })",
    });

    const workloads = new TerraformVariable(
      this,
      "anthropic_federation_workloads",
      {
        description:
          "One service account and federation rule per app and environment, keyed app-env",
        type: "map(object({ workspace_key = string, namespace = string, token_lifetime_seconds = number, onepassword_item_title = string }))",
        default: {},
      },
    );
    // Anthropic caps minted tokens at twice the remaining assertion lifetime.
    // Projected tokens live 600s, so anything above 1200 is not honoured, and
    // a lifetime longer than the kubelet's rotation interval invites a
    // refresh that re-presents a JWT already spent. HCL `for` expressions
    // have no cdktn builder, so the condition is passed whole, never through
    // `Fn`, which would escape it.
    workloads.addValidation({
      condition:
        "${alltrue([for workload in values(var.anthropic_federation_workloads) : workload.token_lifetime_seconds >= 60 && workload.token_lifetime_seconds <= 1200])}",
      errorMessage:
        "token_lifetime_seconds must be between 60 and 1200 to stay inside the projected token's rotation.",
    });

    // Workload identity federation is administered only with a short-lived
    // `org:admin` OAuth token (ANTHROPIC_AUTH_TOKEN); the Admin API key that
    // the `anthropic` stack uses is rejected by these endpoints, for reads as
    // well as writes. That token has to be minted interactively, which is why
    // this stack is operator-applied and never planned in CI. Workspaces
    // still authenticate with ANTHROPIC_ADMIN_API_KEY, so a run needs both.
    new AnthropicProvider(this, "anthropic");

    // Writes each workload's identifiers into its own 1Password item, through
    // the 1Password desktop app for the account named by OP_ACCOUNT.
    new OnepasswordProvider(this, "onepassword");

    new DataAnthropicOrganization(this, "current");

    const workspace = TerraformIterator.fromMap(
      Token.asAnyMap(workspaces.value),
    );
    new Workspace(this, "managed", {
      forEach: workspace,
      name: workspace.getString("name"),
    });

    // Anthropic cannot reach the cluster's issuer, so the signing keys are
    // uploaded inline and the issuer URL is only string-compared against
    // each token's `iss`. Rotating the cluster's service-account signing key
    // breaks every federated workload until this key set is re-applied; see
    // the credential rotation how-to.
    new FederationIssuer(this, "cluster", {
      name: "${var.anthropic_federation_issuer.name}",
      issuerUrl: "${var.anthropic_federation_issuer.issuer_url}",
      jwks: {
        type: "inline",
        keys: "${var.anthropic_federation_issuer.jwks_keys_json}",
      },
      maxJwtLifetimeSeconds: Token.asNumber(
        "${var.anthropic_federation_issuer.max_jwt_lifetime_seconds}",
      ),
      // Replay protection stays on. The runtime re-reads the projected token
      // on every exchange and the kubelet rotates it well inside the minted
      // token's lifetime, so disabling this would only hide a
      // misconfiguration.
      checkJti: true,
    });

    // Three resource types share the HCL name `workload`, but construct ids
    // are unique per scope, so each takes a distinct id and keeps its
    // address through `overrideLogicalId`.
    const serviceAccount = TerraformIterator.fromMap(
      Token.asAnyMap(workloads.value),
    );
    new ServiceAccount(this, "service_account_workload", {
      forEach: serviceAccount,
      name: "${each.key}",
      description:
        "Federated identity for ${each.key}; tokens minted from the ${each.value.namespace} namespace's projected service-account tokens",
    }).overrideLogicalId("workload");

    const serviceAccountWorkspace = TerraformIterator.fromMap(
      Token.asAnyMap(workloads.value),
    );
    const membership = new ServiceAccountWorkspace(
      this,
      "service_account_workspace_workload",
      {
        forEach: serviceAccountWorkspace,
        serviceAccountId: "${anthropic_service_account.workload[each.key].id}",
        workspaceId:
          "${anthropic_workspace.managed[each.value.workspace_key].id}",
        workspaceRole: "workspace_developer",
      },
    );
    membership.overrideLogicalId("workload");

    const rule = TerraformIterator.fromMap(Token.asAnyMap(workloads.value));
    new FederationRule(this, "federation_rule_workload", {
      forEach: rule,
      name: "${each.key}",
      description:
        "Pods in ${each.value.namespace} that mount a projected token for Anthropic",
      issuerId: "${anthropic_federation_issuer.cluster.id}",
      // Each namespace is exactly one app and environment, and only pods
      // that explicitly mount the Anthropic-audience projected token can
      // present one, so matching the namespace scopes the rule without a
      // per-pod service account.
      match: {
        subjectPrefix: "system:serviceaccount:${each.value.namespace}:*",
      },
      target: {
        serviceAccountId: "${anthropic_service_account.workload[each.key].id}",
      },
      // Inference only: these workloads call models and nothing else.
      oauthScope: "workspace:inference",
      workspaceId:
        "${anthropic_workspace.managed[each.value.workspace_key].id}",
      tokenLifetimeSeconds: rule.getNumber("token_lifetime_seconds"),
      dependsOn: [membership],
    }).overrideLogicalId("workload");

    // The identifiers a federated pod needs, one 1Password item per
    // workload, synced into its namespace as ANTHROPIC_* environment
    // variables. They are not secrets (a token can only be minted by
    // presenting a JWT from the trusted issuer whose claims match the rule),
    // so the fields are STRING, not the CONCEALED fields `onePasswordWrite`
    // writes; routing them through 1Password means an apply reaches the
    // cluster without a follow-up commit.
    const identity = TerraformIterator.fromMap(Token.asAnyMap(workloads.value));
    new Item(this, "workload_identity", {
      forEach: identity,
      vault: HOMELAB_VAULT_ID,
      title: identity.getString("onepassword_item_title"),
      category: "secure_note",
      section: [
        {
          label: "federation",
          field: [
            {
              label: "ANTHROPIC_ORGANIZATION_ID",
              type: "STRING",
              value: "${data.anthropic_organization.current.id}",
            },
            {
              label: "ANTHROPIC_FEDERATION_RULE_ID",
              type: "STRING",
              value: "${anthropic_federation_rule.workload[each.key].id}",
            },
            {
              label: "ANTHROPIC_SERVICE_ACCOUNT_ID",
              type: "STRING",
              value: "${anthropic_service_account.workload[each.key].id}",
            },
            {
              label: "ANTHROPIC_WORKSPACE_ID",
              type: "STRING",
              value:
                "${anthropic_workspace.managed[each.value.workspace_key].id}",
            },
          ],
        },
      ],
    });
  }
}
