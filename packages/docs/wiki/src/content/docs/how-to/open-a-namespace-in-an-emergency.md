---
title: Open a namespace in an emergency
description: Break glass when an enforced NetworkPolicy is blocking production traffic, then make the opening permanent in source and remove the break-glass policy.
---

Use this break-glass when an enforced namespace is dropping traffic that
production needs and a revert through a pull request is too slow. It opens the
namespace at once with one allow-all policy applied by hand.

Reverting the stage entry in source is the normal path and is described in
[Cut a namespace over to enforced policies](/how-to/cut-a-namespace-over-to-enforced-policies/#revert).
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
| Create or refresh the one break-glass policy   | Edit the staging policy or any other policy          |
| Open the namespace at once, with no sync       | Change the stage map or anything else in source      |
| Survive ArgoCD self-heal and prune             | Expire or remove itself                              |
| Open every pod the namespace's policies select | Open the peers that this namespace's pods connect to |

ArgoCD acts only on objects it tracks, and the break-glass policy carries no
tracking label or annotation. Nothing reverts it. It stays until you close it.

If the denied connection is to a pod in another enforced namespace, that
namespace's Ingress policy is the one dropping it. Open that namespace too.

To open every namespace that has any policy, pass `--all` in place of the
namespace. Use it when you cannot tell which namespace is at fault.

## 3. Confirm service is back

```bash
bun run netpol:check NAMESPACE --allow-break-glass
```

The `stage` line reads `open (break-glass)`. Without `--allow-break-glass`
the gate fails for as long as the policy exists. That failure is deliberate.
It is how a forgotten break-glass is found.

## 4. Make it permanent in source, then close

A break-glass policy is not the fix. It hides the namespace's stage from
source, and the next person reading the stage map sees `"enforced"` for a
namespace that is wide open. Do both of these, in this order.

1. In
   [`enforcement-stages.ts`](packages/homelab/src/cdk8s/src/fleet-policy/enforcement-stages.ts),
   set the namespace's entry back to `"open"`. Merge the pull request and wait
   for ArgoCD to sync. Confirm the staging policy is open again:

   ```bash
   bun run netpol:check NAMESPACE --expect-stage open --allow-break-glass
   ```

2. Remove the break-glass policy. The dry run shows what would be deleted:

   ```bash
   bun run netpol:open NAMESPACE --close
   bun run netpol:open NAMESPACE --close --apply
   ```

   Use `--all --close` to remove every break-glass policy in the cluster.

:::danger[Do not close before the stage entry has synced]
Closing first returns the namespace to its enforced policies, and the outage
with it. The close dry run states which stage will govern the namespace once
the policy is gone. Read that line before adding `--apply`.
:::

The script deletes only a policy that has both the break-glass name and the
`homelab.sjer.red/break-glass=true` label. It refuses anything that matches
one and not the other, and exits non-zero.

## 5. Confirm nothing is left behind

```bash
bun run netpol:check --all-staged
```

This fails while any namespace still has a break-glass policy, including one
with no staging policy of its own. Then fix the policy that caused the
outage, and cut the namespace over again.

## Related

- [How network policy enforcement works here](/explanation/homelab/network-policy-enforcement/)
- [Cut a namespace over to enforced policies](/how-to/cut-a-namespace-over-to-enforced-policies/)
- [Regain write access to ArgoCD](/how-to/regain-write-access-to-argocd/)
