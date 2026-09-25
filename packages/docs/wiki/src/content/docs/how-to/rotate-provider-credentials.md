---
title: Rotate LLM provider credentials
description: Mint, hand off, and cap one workload's OpenAI key, Gemini key, or Anthropic federation identity, and refresh federation when the cluster signing key changes.
sidebar:
  order: 17
---

Every workload and environment has its own provider credential and its own
provider-side spend cap. This guide replaces one of them without an outage. For
why the three providers differ, see [LLM stack](/explanation/llm-stack/).

Rotate one workload at a time. Keep the previous credential active until its
consumer proves the replacement works, then revoke it.

| Provider  | Stack                  | Applied by | Credential in 1Password                   |
| --------- | ---------------------- | ---------- | ----------------------------------------- |
| OpenAI    | `openai`               | Buildkite  | `OPENAI_API_KEY` field                    |
| Google    | `google`               | Operator   | Per-workload item, written by OpenTofu    |
| Anthropic | `anthropic-federation` | Operator   | Per-workload ID item, written by OpenTofu |

Each workload's 1Password target is in its stack's `desired-state.json` under
[`packages/homelab/src/tofu/`](https://github.com/shepherdjerred/monorepo/tree/main/packages/homelab/src/tofu).
For the OpenAI handoff, put values into 1Password with the app or a
non-printing `op item edit`. Never place a key in a shell argument, file,
command output, or chat.

## 1. Rotate an OpenAI project key

1. Add a new `openai_service_accounts` entry for the workload in
   `openai/desired-state.json`, with a new dated name and the same
   `onepassword_targets`. Keep the old entry.
2. Merge, then apply the stack on a targeted main build with
   `TOFU_PLATFORM_APPLY=openai`.
3. Read the new key from the stack's sensitive `openai_service_account_handoffs`
   output and write it to the target field.
4. Wait for the 1Password Connect operator to refresh the Kubernetes Secret, then
   restart the workload.
5. Confirm a live call succeeds and its project shows usage in the OpenAI
   dashboard. Then remove the old entry and apply again to delete the old
   service account.

The project's hard spend limit, spend alert, and model allowlist are in the same
file. `openai_project_spend_limits` thresholds are in cents and
`openai_project_spend_alerts` thresholds are in dollars; see the
[OpenTofu README](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/tofu/README.md#openai).

Data sharing is set per project in the OpenAI dashboard, under the project's
data controls. The provider cannot manage it. Enable it only on projects whose
traffic may be shared.

## 2. Mint or rotate a Gemini API key

The `google` stack creates each workload's project, a role-less service
account, and a Gemini API key bound to that account. It writes the key into
the workload's own 1Password item, named by `onepassword_item_title`, as
`GEMINI_API_KEY`. The cluster syncs that item directly.

1. Sign in with your own Google credentials, and name the 1Password account
   whose desktop app authorizes the item write:

   ```bash
   gcloud auth application-default login
   export OP_ACCOUNT=my.1password.com
   ```

2. To rotate, bump the workload's `gemini_key_revision` in
   `google/desired-state.json`. OpenTofu mints the replacement and updates the
   item before it deletes the old key.
3. Apply, supplying the stack's state passphrase from 1Password:

   ```bash
   bun packages/homelab/scripts/tofu/tofu-stack.ts google apply
   ```

4. Restart the workload and confirm a Gemini call succeeds.

The apply prints `google_gemini_spend_caps`. Set each project's spend cap in
Google AI Studio, under the project's billing settings, to
`ai_studio_spend_cap_usd`. The cap has no API. The `google_billing_budget` in
the stack only sends alerts.

:::caution
Without a GCP organization only a user can create projects, so this stack
always runs with your own credentials. Before the first apply, create the
billing account and the `google_quota_project_id` project by hand, and record
both in `google/desired-state.json`.
:::

## 3. Apply or change an Anthropic federation identity

Federated workloads hold no secret, so there is no key to rotate. Apply the
stack when a workload, rule, service account, or workspace changes.

1. Authenticate with an organization-admin OAuth token. The federation admin
   endpoints reject API keys:

   ```bash
   ant auth login --scope org:admin
   export OP_ACCOUNT=my.1password.com
   ```

   Supply that token as `ANTHROPIC_AUTH_TOKEN`, with `ANTHROPIC_ADMIN_API_KEY`
   and the stack's state passphrase from 1Password.

2. Edit `anthropic-federation/desired-state.json` and apply:

   ```bash
   bun packages/homelab/scripts/tofu/tofu-stack.ts anthropic-federation apply
   ```

   OpenTofu writes each workload's organization, rule, service account, and
   workspace IDs into its item, named by `onepassword_item_title`. The cluster
   syncs them as `ANTHROPIC_*` variables with no further commit.

3. Restart the workload. Check the Claude Console's workload-identity history
   for successful exchanges, and watch at least three token rotations, about 30
   minutes, for `jti_reused` failures.

Workspace spend limits are Console-only. Set them in the Claude Console under
each workspace's limits.

:::danger
Never give a federated workload `ANTHROPIC_API_KEY`. It outranks federation, so
the workload would appear healthy on a static key. The runtime refuses to start
in that state, and the architecture check rejects the variable in deployment
manifests.
:::

## 4. Refresh federation after a cluster signing-key rotation

Anthropic trusts the cluster's service-account signing key through an inline
JWKS copy. Rotating the Talos service-account key breaks every federated
workload until that copy is updated.

1. Fetch the new JWKS:

   ```bash
   kubectl get --raw /openid/v1/jwks
   ```

2. Replace `jwks_keys_json` in `anthropic-federation/desired-state.json`. During
   the rotation window, include both the old and new keys.
3. Apply the stack as in step 3, then confirm exchanges succeed.
4. Remove the old key after every pod has restarted onto the new signing key.

## Related

- [LLM stack](/explanation/llm-stack/) — why each provider uses a different
  credential model.
- [Attribute LLM spend](/how-to/attribute-llm-spend/) — the live and billed
  spend series, and rotating the billing worker's admin keys.
- [Rotate a Buildkite CI credential](/how-to/rotate-buildkite-credentials/) — the
  release refiner's `OPENAI_API_KEY` grant.
