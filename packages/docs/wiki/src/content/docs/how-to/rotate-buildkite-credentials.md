---
title: Rotate a Buildkite CI credential
description: Replace one scoped Buildkite credential and verify its 1Password, Kubernetes, CI, and legacy-retirement boundaries.
---

Use this procedure after Buildkite jobs have moved to the exact grants in
`.buildkite/secret-grants.json`. Rotate one semantic field at a time so a failed
acceptance check identifies one provider boundary.

## 1. Identify the rotation unit

Find the job grants for the credential in
`.buildkite/secret-grants.json`. Confirm the field belongs to the expected
issuer item and list the affected Buildkite step keys. Do not change the
pipeline when replacing a value behind an existing semantic field.

If a narrower provider identity is not ready, stop. Copying a broad value into
a semantic field is acceptable only during the initial migration; it is not a
completed rotation.

## 2. Replace the field in 1Password

Mint the replacement identity with the provider, then update only the matching
field in its dedicated Buildkite 1Password item. Use the 1Password app or a
non-printing `op item edit` invocation. Do not place the value in a shell
argument, file, snapshot, command output, or chat.

Keep the previous identity active until the replacement passes the live checks
below.

## 3. Wait for 1Password reconciliation

Argo CD owns the `OnePasswordItem` resource. The 1Password Connect operator
turns that resource into the same-named Kubernetes Secret. Wait for the
Application to become synced and healthy, then confirm both resources exist:

```bash
kubectl get onepassworditem -n buildkite <secret-name>
kubectl get secret -n buildkite <secret-name>
```

Print key names only and compare them with the manifest. Do not print or decode
values:

```bash
kubectl get secret -n buildkite <secret-name> -o json |
  jq -r '.data | keys[]'
```

## 4. Prove the job boundary

Confirm the job identity still cannot enumerate or read Kubernetes Secrets:

```bash
kubectl auth can-i list secrets \
  --as=system:serviceaccount:buildkite:buildkite-job -n buildkite
kubectl auth can-i get secrets \
  --as=system:serviceaccount:buildkite:buildkite-job -n buildkite
```

Both commands must return `no`. Inspect a pod from each affected step and
confirm only `container-0` contains the expected `secretKeyRef`; the agent,
checkout, init, and sidecar containers must contain none. The pod must use
`buildkite-job` with `automountServiceAccountToken: false`.

## 5. Run live acceptance

Trigger or wait for the affected lane on the exact current `main` commit. A
source check or successful Secret reconciliation is not enough: require the
Buildkite job itself to pass and require any deployment it performs to finish
successfully.

If the job fails authentication, restore the previous field value, wait for the
1Password operator to reconcile it, and diagnose the provider identity before
trying another rotation.

## 6. Retire the previous identity

After the exact-main job and its deployment acceptance pass, revoke the prior
provider identity. During the aggregate-Secret migration, first confirm no live
pod references `buildkite-ci-secrets` and Argo CD has removed that Secret; only
then archive the old aggregate 1Password item.
