---
title: Regain write access to ArgoCD
description: Break glass when Delivery cannot make an ArgoCD change, then return people to read-only access.
---

Use this break-glass when an Application must change and Delivery cannot make
the change. After the Delivery v2 lock-down, people sign in to ArgoCD as the
read-only `operator` account. Only Delivery's ArgoCD account changes, syncs, or
deletes Applications, and an admission policy refuses any other identity that
writes an Application's source.

Both controls are rendered from source.
`humanArgoCdReadOnly()` in
`packages/homelab/src/cdk8s/src/resources/argo-applications/platform/argocd-human-access.ts`
disables the built-in `admin` account. The `argocd-application-source.sjer.red`
policy in
`packages/homelab/src/cdk8s/src/resources/argocd-application-admission.ts`
guards Application sources. You need cluster-admin `kubectl` access to the
homelab.

## 1. Stop Delivery from reverting you

Delivery re-applies each Application's full body and self-heals drift. Turn
`delivery-writes-enabled` off in the `delivery` namespace of the `prod` Flipt
environment, as in
[Check the Flipt flag inventory](/how-to/check-flipt-flag-inventory/). Delivery
then admits no new deployment, but a running deployment can still finish and
re-apply an Application this procedure changes.

Wait until every environment whose Application you will change has drained:
the target Application's (its `delivery.shepherdjerred.com/environment`
annotation), `argocd/prod` (step 1 always patches `argocd`), and
`cluster-admission/prod` if you will run step 3. Every line must end in
`true` before you continue; a failed request or an unexpected response prints
`not drained` instead:

```bash
for environment in argocd/prod cluster-admission/prod <target-environment-id>; do
  printf '%s ' "$environment"
  curl -fsS "https://delivery.tailnet-1a49.ts.net/api/v1/environments/$(jq -rn --arg id "$environment" '$id | @uri')" \
    | jq -e '.environment | has("activeDeploymentId") and .activeDeploymentId == null' \
    || echo "not drained"
done
```

Then stop ArgoCD from reverting its own settings. Save the `argocd`
Application's current policy first so step 4 can restore it. Each command runs
only if the one before it succeeded, so a failed read changes nothing; fix the
access problem and run the block again:

```bash
kubectl -n argocd get application argocd -o json \
  > argocd-application.json \
  && jq -c '.spec.syncPolicy.automated // empty' argocd-application.json \
    > argocd-automated.json \
  && kubectl -n argocd patch application argocd --type merge \
    -p '{"spec":{"syncPolicy":{"automated":null}}}'
```

## 2. Re-enable the admin account

```bash
kubectl -n argocd patch configmap argocd-cm --type merge \
  -p '{"data":{"admin.enabled":"true"}}'
```

The operator `admin` token used by
[Cut a homelab release](/how-to/cut-a-homelab-release/) works again. Use it
through the ArgoCD UI, the `argocd` CLI, or the operator-run bootstrap tools.

## 3. Write a source directly only if ArgoCD is down

Skip this step while the ArgoCD API answers: writes made through it pass the
source policy. If the API is down and an Application's source must change,
first stop the `cluster-admission` Application's automated sync. Otherwise it
recreates the binding on its next reconciliation. Save its current policy so
step 4 can restore it; as in step 1, a failed read stops the block before
anything changes:

```bash
kubectl -n argocd get application cluster-admission -o json \
  > cluster-admission-application.json \
  && jq -c '.spec.syncPolicy.automated // empty' \
    cluster-admission-application.json > cluster-admission-automated.json \
  && kubectl -n argocd patch application cluster-admission --type merge \
    -p '{"spec":{"syncPolicy":{"automated":null}}}'
```

Then lift the policy binding:

```bash
kubectl delete validatingadmissionpolicybinding argocd-application-source.sjer.red
```

## 4. Return to read-only

1. If you ran step 3, restore `cluster-admission`'s saved automated policy.
   Nothing else restores it, because it is operator-created, not one of
   Delivery's Applications:

   ```bash
   kubectl -n argocd patch application cluster-admission --type merge \
     -p "{\"spec\":{\"syncPolicy\":{\"automated\":$(cat cluster-admission-automated.json)}}}"
   ```

   An empty file means it had no automated policy; skip the patch.
   `kubectl -n argocd get application cluster-admission -o json | jq -c '.spec.syncPolicy.automated'`
   prints the saved policy. Then re-sync `cluster-admission` so the binding is
   back: `kubectl get validatingadmissionpolicybinding argocd-application-source.sjer.red`
   finds it.

2. Restore the `argocd` Application's saved automated policy. A sync
   reconciles only its child resources, and Delivery rewrites an
   Application's sync policy only when it next deploys that environment, so
   nothing else restores it:

   ```bash
   kubectl -n argocd patch application argocd --type merge \
     -p "{\"spec\":{\"syncPolicy\":{\"automated\":$(cat argocd-automated.json)}}}"
   ```

   An empty file means it had no automated policy; skip the patch. Then
   re-sync `argocd` from its accepted source and confirm
   `kubectl -n argocd get configmap argocd-cm -o jsonpath='{.data.admin\.enabled}'`
   prints `false`.

3. Turn `delivery-writes-enabled` back on. Delivery restores automated sync and
   self-heal on the Applications it owns at its next deployment of each.

:::caution
Record the break-glass in the Delivery hub as an operator-run deployment of the
service you changed. Delivery cannot see a change made around it, so the record
is the only evidence.
:::

## Related

- [Set the ArgoCD operator password](/how-to/set-the-argocd-operator-password/)
- [Cut a homelab release](/how-to/cut-a-homelab-release/)
- [Check the Flipt flag inventory](/how-to/check-flipt-flag-inventory/)
