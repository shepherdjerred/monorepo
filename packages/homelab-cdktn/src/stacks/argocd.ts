import type { Construct } from "constructs";
import { TerraformOutput, TerraformVariable } from "cdktn";
import { AccountToken } from "#generated/providers/argocd/account-token/index.ts";
import { ArgocdProvider } from "#generated/providers/argocd/provider/index.ts";
import { OnepasswordProvider } from "#generated/providers/onepassword/provider/index.ts";
import { HomelabStack } from "#src/homelab-stack.ts";
import { onePasswordWrite } from "#src/onepassword.ts";

type AccountTokenHandoff = {
  /** `argocd_account_token.<token>`. */
  readonly token: string;
  /** ArgoCD account, registered by the ArgoCD chart before the token is issued. */
  readonly account: string;
  /** `onepassword_item.<item>`. */
  readonly item: string;
  readonly title: string;
  /** The one concealed field in the item's `tokens` section. */
  readonly field: string;
  readonly output: string;
  readonly outputDescription: string;
};

// The retired Woodpecker token/item are intentionally absent. Apply only
// after the reviewed scoped accounts exist; inspect their planned destruction
// during the clean cutover, before removing the legacy account from the
// final chart.
const HANDOFFS: readonly AccountTokenHandoff[] = [
  // The account and its narrow Application permissions are owned by the
  // ArgoCD chart. Apply that account registration before creating this token.
  {
    token: "delivery",
    account: "delivery",
    item: "argocd_delivery_token",
    title: "delivery-argocd-token",
    field: "ARGOCD_TOKEN",
    output: "delivery_onepassword_item_id",
    outputDescription:
      "1Password item UUID for the scoped Delivery ArgoCD token",
  },
  {
    token: "delivery_observer",
    account: "delivery-observer",
    item: "argocd_delivery_observer_token",
    title: "delivery-argocd-observer-token",
    field: "ARGOCD_RECOVERY_TOKEN",
    output: "delivery_observer_onepassword_item_id",
    outputDescription:
      "1Password item UUID for the read-only Delivery ArgoCD recovery token",
  },
  // Apply the reviewed delivery-platform account/RBAC before this
  // operator-owned stack. This is a new account token, never a copy of the
  // legacy CI credential.
  {
    token: "delivery_platform",
    account: "delivery-platform",
    item: "argocd_delivery_platform_token",
    title: "delivery-argocd-platform-token",
    field: "ARGOCD_TOKEN",
    output: "delivery_platform_onepassword_item_id",
    outputDescription:
      "Issued dedicated platform ArgoCD item; register as platformArgocd before enabling platform execution",
  },
  // The operator tool's account for operator-run Applications
  // (cluster-admission and the data layers). The ArgoCD chart defines it with
  // no grant before the Delivery v2 window, so this token may be issued at
  // any time. Only operators read the item; nothing in the cluster mounts it.
  {
    token: "operator_run",
    account: "operator-run",
    item: "argocd_operator_run_token",
    title: "delivery-argocd-operator-run-token",
    field: "ARGOCD_TOKEN",
    output: "operator_run_onepassword_item_id",
    outputDescription:
      "1Password item UUID for the operator tool's ArgoCD token for operator-run Applications",
  },
  // The read-only API account agent workstations use through toolkit. The
  // ArgoCD chart registers it with `role:readonly` and no login; apply that
  // registration before creating this token. Workstations read the item;
  // nothing in the cluster mounts it.
  {
    token: "workstation",
    account: "workstation",
    item: "argocd_workstation_token",
    title: "argocd-workstation-token",
    field: "ARGOCD_AUTH_TOKEN",
    output: "workstation_onepassword_item_id",
    outputDescription:
      "1Password item UUID for the read-only workstation ArgoCD token toolkit uses",
  },
  // The read-only API account the Temporal homelab audit uses through
  // `toolkit argocd`. Register it in the ArgoCD chart before creating this
  // token. The temporal worker's 1Password operator item projects the field
  // as ARGOCD_AUTH_TOKEN.
  {
    token: "homelab_audit",
    account: "homelab-audit",
    item: "argocd_homelab_audit_token",
    title: "argocd-homelab-audit-token",
    field: "ARGOCD_AUTH_TOKEN",
    output: "homelab_audit_onepassword_item_id",
    outputDescription:
      "1Password item UUID for the read-only homelab-audit ArgoCD token",
  },
];

/**
 * Operator-run: ArgoCD API tokens for the scoped Delivery, operator and
 * read-only accounts, each handed to the workload that reads it through a
 * 1Password item.
 */
export class ArgocdStack extends HomelabStack {
  constructor(scope: Construct) {
    super(scope, "argocd", {
      requiredVersion: ">= 1.6.0",
      providerConstraints: { argocd: "~> 7.0", onepassword: "~> 3.0" },
    });

    const authToken = new TerraformVariable(this, "argocd_auth_token", {
      description:
        "Token of the tofu-argocd ArgoCD account, which may only read and issue tokens for the Delivery accounts this stack mints",
      type: "string",
      sensitive: true,
    });

    new ArgocdProvider(this, "argocd", {
      serverAddr: "argocd.tailnet-1a49.ts.net:443",
      authToken: authToken.stringValue,
    });

    // The operator-run wrapper supplies a vault-scoped service account
    // through OP_SERVICE_ACCOUNT_TOKEN. The in-cluster Connect token is
    // read-only.
    new OnepasswordProvider(this, "onepassword");

    for (const handoff of HANDOFFS) {
      const token = new AccountToken(this, handoff.token, {
        account: handoff.account,
      });
      const item = onePasswordWrite(this, handoff.item, {
        title: handoff.title,
        section: "tokens",
        fields: { [handoff.field]: token.jwt },
      });
      new TerraformOutput(this, handoff.output, {
        description: handoff.outputDescription,
        value: item.uuid,
      });
    }
  }
}
