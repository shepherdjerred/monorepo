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
then admits no new deployment, and running operations can still finish.

Then stop ArgoCD from reverting its own settings:

```bash
kubectl -n argocd patch application argocd --type merge \
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
recreates the binding on its next reconciliation:

```bash
kubectl -n argocd patch application cluster-admission --type merge \
  -p '{"spec":{"syncPolicy":{"automated":null}}}'
```

Then lift the policy binding:

```bash
kubectl delete validatingadmissionpolicybinding argocd-application-source.sjer.red
```

## 4. Return to read-only

1. Re-sync `cluster-admission` so the binding is back:
   `kubectl get validatingadmissionpolicybinding argocd-application-source.sjer.red`
   finds it.
2. Re-sync the `argocd` Application from its accepted source. Confirm
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
