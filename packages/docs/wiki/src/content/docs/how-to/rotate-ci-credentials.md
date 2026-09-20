---
title: Rotate a CI credential
description: Replace one scoped CI credential and verify its 1Password, Kubernetes, CI, and legacy-retirement boundaries.
---

CI steps receive credentials as exact Kubernetes secret references, declared per
step by the configuration extension
(`packages/woodpecker-config-extension/src/pipeline/lanes/`). Rotate one
semantic field at a time so a failed acceptance check identifies one provider
boundary.

## 1. Identify the rotation unit

Find the steps that name the credential. Each lane declares its grants as
`{ secret, key, env }` entries, and
`bun scripts/checks/ci/check-ci-env.ts` verifies that every step's commands can
only read the variables its own grants provide.

Confirm the field belongs to the expected issuer item and list the affected step
keys. Do not change the pipeline when replacing a value behind an existing
semantic field.

If a narrower provider identity is not ready, stop. Copying a broad value into
a semantic field is acceptable only during an initial migration; it is not a
completed rotation.

## 2. Replace the field in 1Password

Mint the replacement identity with the provider, then update only the matching
field in its dedicated CI 1Password item — the items are listed in
`packages/homelab/src/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts`.
Use the 1Password app or a non-printing `op item edit` invocation. Do not place
the value in a shell argument, file, snapshot, command output, or chat.

Keep the previous identity active until the replacement passes the live checks
below.

## 3. Wait for 1Password reconciliation

Argo CD owns the `OnePasswordItem` resource. The 1Password Connect operator
turns that resource into the same-named Kubernetes Secret. Wait for the
Application to become synced and healthy, then confirm both resources exist:

```bash
kubectl get onepassworditem -n woodpecker <secret-name>
kubectl get secret -n woodpecker <secret-name>
```

Print key names only and compare them with the manifest. Do not print or decode
values:

```bash
kubectl get secret -n woodpecker <secret-name> -o json |
  jq -r '.data | keys[]'
```

## 4. Prove the step boundary

Confirm the step identity still cannot enumerate or read Kubernetes Secrets:

```bash
kubectl auth can-i list secrets \
  --as=system:serviceaccount:woodpecker:woodpecker-job -n woodpecker
kubectl auth can-i get secrets \
  --as=system:serviceaccount:woodpecker:woodpecker-job -n woodpecker
```

Both commands must return `no`. Inspect a pod from each affected step and
confirm it carries only the expected `secretKeyRef` entries and nothing more.
The pod must use `woodpecker-job` with `automountServiceAccountToken: false`.

Woodpecker never holds these values itself: the agent runs with
`WOODPECKER_BACKEND_K8S_ALLOW_NATIVE_SECRETS`, so a step names an existing
Kubernetes Secret rather than storing one in Woodpecker's database.

:::caution
Woodpecker masks only secrets from its own store, so these values are **not**
redacted from step logs. That is the accepted trade for keeping them in
1Password; do not echo a credential in a step command.
:::

## 5. Run live acceptance

Trigger or wait for the affected lane on the exact current `main` commit. A
source check or successful Secret reconciliation is not enough: require the CI
step itself to pass and require any deployment it performs to finish
successfully.

If the step fails authentication, restore the previous field value, wait for the
1Password operator to reconcile it, and diagnose the provider identity before
trying another rotation.

## 6. Retire the previous identity

After the exact-main step and its deployment acceptance pass, revoke the prior
provider identity.
