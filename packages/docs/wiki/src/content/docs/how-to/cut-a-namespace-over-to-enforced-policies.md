---
title: Cut a namespace over to enforced policies
description: Move one namespace from the open stage to its own NetworkPolicies, check it live, and revert it if anything breaks.
---

Use this procedure to make one namespace's NetworkPolicies decide its traffic.
It changes one entry in the stage map, then proves the namespace still works.
[How network policy enforcement works here](/explanation/homelab/network-policy-enforcement/)
explains the stages and why they exist.

You need cluster `kubectl` access, a tailnet connection and `toolkit`. Run the
`bun run` commands from `packages/homelab`. They are read-only.

:::caution[A cutover does nothing until the cluster enforces]
Before enforcement is switched on, an `"enforced"` namespace behaves exactly
like an open one, and nothing here can tell you whether its policies are
right. Confirm the enforcer runs first. This must print
`kube-network-policies` beside `kube-flannel`:

```bash
kubectl --namespace kube-system get daemonset kube-flannel \
  -o jsonpath='{.spec.template.spec.containers[*].name}{"\n"}'
```

:::

## 1. Pick the namespace

Cut namespaces over one at a time, lowest risk first. A later group depends on
the earlier ones being settled, so do not skip ahead.

| Order | Namespaces                                                                                                                | Why here                                            |
| ----- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1     | `redlib`, `freshrss`, `stash`, `pinchtab`, `glitter-boys-launcher`, `trmnl-dashboard`                                     | Leaf services with one or two policies              |
| 2     | `tracker`, `alert-dashboard`, `tasknotes`, `birmel`, `flipt`, `relay`, `storm-brain`, `storm-forum`, `bugsink`, `phoenix` | First-party web services and bots                   |
| 3     | `media`, `syncthing`, `postal`, `minecraft-shuxin`, `minecraft-sjerred`, `minecraft-tsmc`                                 | Many workloads, host ports and LAN clients          |
| 4     | `home`                                                                                                                    | Host-network pods beside pod-network ones           |
| 5     | `scout-beta`, then `scout-prod`                                                                                           | Beta proves the policies before production          |
| 6     | `seaweedfs`, `prometheus`                                                                                                 | Shared storage and monitoring that others depend on |
| 7     | `woodpecker`, `buildkitd`, then `woodpecker-ci`                                                                           | CI; every step pod passes through the enforcer      |
| 8     | `temporal`, the `delivery*` namespaces, then `argocd`                                                                     | The release path itself, last                       |

Two ordering constraints override the table.

**The tunnel fix must be live before `woodpecker`, `delivery` or `temporal`.**
They call each other through public tunnel URLs, and cloudflared runs in
`cloudflare-operator-system`. A live policy that still admits the empty
`cloudflare-tunnel` namespace closes the route. This must print nothing:

```bash
kubectl get networkpolicy --all-namespaces -o json | jq -r '
  .items[]
  | select([.spec.ingress[]?.from[]?.namespaceSelector.matchLabels["kubernetes.io/metadata.name"]]
           | index("cloudflare-tunnel"))
  | "\(.metadata.namespace)/\(.metadata.name)"'
```

**The CI apt sources must use HTTPS before `woodpecker-ci`.** The step policy
allows outbound TCP 443 only, and the CI base image's apt sources use plain
HTTP. A step that runs `apt-get update` fails once the namespace is enforced.
Tracker AI-611 tracks the fix.

For `woodpecker-ci`, also record a pipeline's duration before the cutover and
compare it afterwards. Every new connection of every step pod is decided by
the enforcer.

## 2. Take a baseline

Run the gate while the namespace is still open. Replace `NAMESPACE` throughout.

```bash
bun run netpol:check NAMESPACE --expect-stage open
```

No check may fail. Fix anything that does now. A namespace that is unhealthy before the cutover cannot be judged after
it.

Read the `urls` and `probes` lines. A URL listed as not checked, or a
namespace with no URL and no probe, has less evidence behind it. Decide what
you will do by hand in step 4 to make up for it.

## 3. Flip the stage entry

In
[`enforcement-stages.ts`](packages/homelab/src/cdk8s/src/fleet-policy/enforcement-stages.ts),
change the namespace's entry in `ENFORCEMENT_STAGES`. For `tracker`:

```diff
-  tracker: "open",
+  tracker: "enforced",
```

Open a pull request with that one change and merge it when it is green. One
namespace per pull request keeps the revert a single line.

The staging policy ships with the namespace's own release. `argocd` and
`prometheus` are the exception. Their staging policy is rendered by the root
`apps` chart, so it reaches the cluster with a root release. See
[Cut a homelab release](/how-to/cut-a-homelab-release/).

## 4. Check the namespace once ArgoCD has synced

1. Confirm the live policy changed. This prints `enforced` once the sync has
   landed:

   ```bash
   kubectl --namespace NAMESPACE get networkpolicy enforcement-staging-NAMESPACE \
     -o jsonpath='{.metadata.annotations.homelab\.sjer\.red/enforcement-stage}{"\n"}'
   ```

2. Run the gate again. It must exit zero:

   ```bash
   bun run netpol:check NAMESPACE --expect-stage enforced
   ```

   | Check      | Passes when                                                           |
   | ---------- | --------------------------------------------------------------------- |
   | `stage`    | The live stage matches and no break-glass policy exists               |
   | `pods`     | Every pod is Ready and no container restarted in the window           |
   | `services` | Every Service backed by pods has a ready endpoint                     |
   | `urls`     | The namespace's public and tailnet URLs answer as their probes expect |
   | `probes`   | Every blackbox probe of the namespace reports success                 |
   | `denials`  | Never fails. It lists enforcer log lines that look like denials       |

   The restart and denial window is ten minutes. Widen it with
   `--since-minutes` when the sync landed earlier than that.

3. Exercise the namespace's own user flow. Sign in, load the page that calls
   its database, send the message, start the job. The gate only sees
   connections into the namespace. An outbound call the policy forgot fails
   here and nowhere else.

4. Read the enforcer's log for the window that covers step 3. The `denials`
   check is a note, not a gate, so read it yourself:

   ```bash
   kubectl --namespace kube-system logs \
     --selector k8s-app=flannel,tier=node \
     --container kube-network-policies \
     --since=10m --tail=-1 --prefix \
     | grep -iE 'den(y|ied)|drop|reject' \
     | grep -E '(^|[^a-z0-9-])NAMESPACE([^a-z0-9-]|$)'
   ```

   A denial that names the namespace is either a rule the policy is missing or
   traffic it was written to stop. Decide which before you move on. The peer
   on the other end may be the one that needs the rule.

5. Check the namespaces that call this one. A caller in an `"open"` namespace
   is still limited by this namespace's Ingress policy. Run the gate for each
   caller you know of.

When a batch is done, confirm nothing else moved:

```bash
bun run netpol:check --all-staged
```

## Revert

Change the entry back to `"open"`, merge, and wait for the sync. The staging
policy selects every pod again and the namespace behaves as it did before.
Confirm it:

```bash
bun run netpol:check NAMESPACE --expect-stage open
```

If the namespace cannot wait for a merge and a sync,
[open it in an emergency](/how-to/open-a-namespace-in-an-emergency/) first,
then make the same change in source.

Fix the policy before trying again. A revert restores service. It does not
explain the denial.

## Related

- [How network policy enforcement works here](/explanation/homelab/network-policy-enforcement/)
- [Open a namespace in an emergency](/how-to/open-a-namespace-in-an-emergency/)
- [Cut a homelab release](/how-to/cut-a-homelab-release/)
