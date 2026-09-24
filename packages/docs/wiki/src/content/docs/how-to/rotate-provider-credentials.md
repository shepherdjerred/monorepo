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

| Provider  | Stack                  | Applied by | Credential in 1Password |
| --------- | ---------------------- | ---------- | ----------------------- |
| OpenAI    | `openai`               | Buildkite  | `OPENAI_API_KEY` field  |
| Google    | `google`               | Operator   | `GEMINI_API_KEY` field  |
| Anthropic | `anthropic-federation` | Operator   | None; the pod federates |

Each workload's 1Password item and field are in its stack's
`desired-state.json` under
[`packages/homelab/src/tofu/`](https://github.com/shepherdjerred/monorepo/tree/main/packages/homelab/src/tofu).
Put values into 1Password with the app or a non-printing `op item edit`. Never
place a key in a shell argument, file, command output, or chat.

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

## 2. Rotate a Gemini API key

OpenTofu creates each workload's project and a role-less service account. Only
`gcloud` can mint a key bound to that service account.

1. Read the targets. The output is not secret:

   ```bash
   bun packages/homelab/scripts/tofu/tofu-stack.ts google apply
   ```

   The apply prints `google_gemini_key_targets` with each workload's
   `project_id`, `service_account_email`, spend cap, and 1Password target.

2. Mint a key restricted to the Gemini API:

   ```bash
   gcloud beta services api-keys create \
     --project=<project_id> \
     --display-name=<workload>-<yyyy-mm> \
     --service-account=<service_account_email> \
     --api-target=service=generativelanguage.googleapis.com
   ```

   Copy the key string straight into the target field in 1Password.

3. Restart the workload and confirm a Gemini call succeeds.
4. Delete the previous key with `gcloud services api-keys delete`.

Set the project's spend cap in Google AI Studio, under the project's billing
settings, to `ai_studio_spend_cap_usd`. The cap is Console-only. The
`google_billing_budget` in the stack only sends alerts.

:::caution
The stack runs with your own Application Default Credentials, because without a
GCP organization only a user can create projects. Run `gcloud auth application-default login`
first, and create the `google_quota_project_id` project once by hand before the
first apply.
:::

## 3. Rotate an Anthropic federation identity

Federated workloads hold no secret, so there is no key to rotate. Recreate the
identity only when a rule, service account, or workspace must change.

1. Authenticate with an organization-admin OAuth token. The federation admin
   endpoints reject API keys:

   ```bash
   ant auth login --scope org:admin
   ```

   Supply that token as `ANTHROPIC_AUTH_TOKEN`, with `ANTHROPIC_ADMIN_API_KEY`
   and the stack's state passphrase from 1Password.

2. Edit `anthropic-federation/desired-state.json` and apply:

   ```bash
   bun packages/homelab/scripts/tofu/tofu-stack.ts anthropic-federation apply
   ```

3. Export the identifiers into the committed inventory, and commit the result:

   ```bash
   bun packages/homelab/scripts/tofu/tofu-stack.ts anthropic-federation export-workload-identity
   ```

4. After the release reaches the cluster, check the Claude Console's
   workload-identity history for successful exchanges. Watch at least three
   token rotations, about 30 minutes, for `jti_reused` failures.

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
