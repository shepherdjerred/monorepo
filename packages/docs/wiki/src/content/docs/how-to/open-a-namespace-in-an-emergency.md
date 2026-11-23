---
title: Open a namespace in an emergency
description: Break glass when an enforced NetworkPolicy is blocking production traffic, then fix the policy in source and remove the break-glass policy.
---

Use this break-glass when a namespace's NetworkPolicies are dropping traffic
that production needs and a fix through a pull request is too slow. It opens
the namespace at once with one allow-all policy applied by hand.

Fixing the policy in source is the normal path, described in
[Check a namespace under enforced policies](/how-to/check-a-namespace-under-enforced-policies/).
Break glass only when the outage cannot wait for a merge and a sync, or when
the release path itself is what the policy broke.

You need cluster-admin `kubectl` access. Run the commands from
`packages/homelab`. Replace `NAMESPACE` throughout.

## 1. See what would be applied

Without `--apply` the script changes nothing. It prints the policy it would
create and the follow-up it will require:

```bash
bun run netpol:open NAMESPACE
```

## 2. Open the namespace

`--apply` writes to the live cluster and requires a reason:

```bash
bun run netpol:open NAMESPACE --apply --reason "tracker sign-in blocked after cutover"
```

The script creates one NetworkPolicy, `enforcement-break-glass-NAMESPACE`,
that selects every pod and allows all traffic both ways. It records the
reason, the kubectl context and the time as annotations on that policy. It
exits non-zero if the namespace is not open afterwards.

| It does                                        | It does not                                          |
| ---------------------------------------------- | ---------------------------------------------------- |
| Create or refresh the one break-glass policy   | Edit any other policy                                |
| Open the namespace at once, with no sync       | Change anything in source                            |
| Survive ArgoCD self-heal and prune             | Expire or remove itself                              |
| Open every pod the namespace's policies select | Open the peers that this namespace's pods connect to |

ArgoCD acts only on objects it tracks, and the break-glass policy carries no
tracking label or annotation. Nothing reverts it. It stays until you close it.
While it exists, the `NetworkPolicyBreakGlassActive` alert fires for it and
the **Break-glass policies** table of the **NetworkPolicy enforcement** Grafana
dashboard (uid `network-policy-enforcement`) lists it.

If the denied connection is to a pod in another namespace, that namespace's
Ingress policy may be the one dropping it. Open that namespace too.

To open every namespace that has any policy, pass `--all` in place of the
namespace. Use it when you cannot tell which namespace is at fault.

## 3. Confirm service is back

```bash
bun run netpol:check NAMESPACE --allow-break-glass
```

The `break-glass` line reads `open (break-glass)`. Without
`--allow-break-glass` the gate fails for as long as the policy exists. That
failure is deliberate. It is how a forgotten break-glass is found.

## 4. Fix the policy in source, then close

A break-glass policy is not the fix. It hides the namespace's policies from
source: the next person reading the chart sees rules that the cluster does not
apply. Do both of these, in this order.

1. Find the connection the policy dropped and add the rule that allows it, or
   revert the change that removed it. The denials from before you opened the
   namespace are still in Loki;
   [Check a namespace under enforced policies](/how-to/check-a-namespace-under-enforced-policies/)
   shows how to read them. Merge the pull request and wait for ArgoCD to sync
   it.

2. Remove the break-glass policy. The dry run shows what would be deleted:

   ```bash
   bun run netpol:open NAMESPACE --close
   bun run netpol:open NAMESPACE --close --apply
   ```

   Use `--all --close` to remove every break-glass policy in the cluster.

:::danger[Do not close before the fix has synced]
Closing returns the namespace to its own policies. Before the fix is live,
that brings the outage back. While the break-glass policy exists, nothing can
prove the fix: closing is the test. Run the gate right after closing, and
open the namespace again if it fails.
:::

The script deletes only a policy that has both the break-glass name and the
`homelab.sjer.red/break-glass=true` label. It refuses anything that matches
one and not the other, and exits non-zero.

## 5. Confirm the fix and that nothing is left behind

```bash
bun run netpol:check NAMESPACE
bun run netpol:check --all
```

The first checks the namespace under its own policies again; exercise its
user flow too, since the gate sees only inbound connections. The second fails
while any namespace still has a break-glass policy.
`NetworkPolicyBreakGlassActive` resolves within a few minutes of the last
close.

## Related

- [How network policy enforcement works here](/explanation/homelab/network-policy-enforcement/)
- [Check a namespace under enforced policies](/how-to/check-a-namespace-under-enforced-policies/)
- [Regain write access to ArgoCD](/how-to/regain-write-access-to-argocd/)
