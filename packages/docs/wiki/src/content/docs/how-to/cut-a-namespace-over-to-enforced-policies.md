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

The enforcer fails open. Do not cut a namespace over while
`NetworkPolicyEnforcerNotRunning` or `NetworkPolicyEnforcerRestarted` is
firing. [Watching the enforcer](#watching-the-enforcer) lists what reports it.

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
   | `denials`  | Never fails. It counts the namespace's denials in Loki                |

   The restart and denial window is ten minutes. Widen it with
   `--since-minutes` when the sync landed earlier than that.

3. Exercise the namespace's own user flow. Sign in, load the page that calls
   its database, send the message, start the job. The gate only sees
   connections into the namespace. An outbound call the policy forgot fails
   here and nowhere else.

4. Read the denials for the window that covers step 3. The `denials` check
   is a note, not a gate, so read it yourself:

   ```bash
   bun run netpol:check NAMESPACE --since-minutes 30
   ```

   The enforcer's denial line names only the packet's `id`. The check pairs
   it with the same agent pod's `Evaluating packet` line for that `id`, which
   names the source and destination pods, and prints the first five pairs.
   It reads both from Loki: on a busy node the enforcer's container log
   rotates within about a minute, so `kubectl logs` misses most of the
   window. `not available` means Loki could not be read, not that nothing was
   denied.

   To see every pair, list the denials, then each agent pod's packets for
   their ids:

   ```bash
   toolkit loki query --since 30m --limit 5000 \
     '{namespace="kube-system", container="kube-network-policies"} |~ "Packet denied by (egress|ingress) policy"'
   toolkit loki query --since 30m --limit 5000 \
     '{namespace="kube-system", container="kube-network-policies", pod="AGENT_POD"} |= "Evaluating packet" |~ "id=(ID|ID)[^0-9]"'
   ```

   An agent evaluates a packet's egress and then its ingress under the same
   `id`; the evaluation logged last before the denial is its packet.

   An egress denial needs a rule on the `srcPod` side, an ingress denial on
   the `dstPod` side. `external` is an address outside the pod network. Each
   denial is either a rule the policy is missing or traffic it was written to
   stop. Decide which before you move on. The peer on the other end may be the
   one that needs the rule.

   The **NetworkPolicy enforcement** Grafana dashboard (uid
   `network-policy-enforcement`) charts denials per node and direction over
   the same window, and its **Denials with their packets** panel shows these
   line pairs for every namespace.

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

## Watching the enforcer

These ship with the cluster's observability chart and match nothing until the
enforcer container exists.

| Signal                              | Source                                   | Reports                                                                     |
| ----------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| `NetworkPolicyEnforcerNotRunning`   | kube-state-metrics                       | A node of `kube-flannel` without a running enforcer for five minutes        |
| `NetworkPolicyEnforcerRestarted`    | kube-state-metrics                       | An enforcer restart in the last fifteen minutes, with its node              |
| `NetworkPolicyBreakGlassActive`     | kube-state-metrics                       | An `enforcement-break-glass-*` policy that has existed for five minutes     |
| NetworkPolicy enforcement dashboard | Prometheus, the enforcer's metrics, Loki | Enforcers and restarts, verdicts, latency, denials and break-glass policies |

The alerts are defined in
`packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/platform/network-policy-enforcement.ts`
and the dashboard in
`packages/homelab/src/cdk8s/grafana/network-policy-enforcement-dashboard.ts`.
The enforcer's metrics count verdicts per node only. No metric names a
namespace or a policy, so a rise in one namespace's denials shows up only in
the log, and no alert watches it.

## Related

- [How network policy enforcement works here](/explanation/homelab/network-policy-enforcement/)
- [Open a namespace in an emergency](/how-to/open-a-namespace-in-an-emergency/)
- [Cut a homelab release](/how-to/cut-a-homelab-release/)
