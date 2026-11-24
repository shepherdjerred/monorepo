---
title: Check a namespace under enforced policies
description: Prove a namespace still works after a NetworkPolicy change, read the connections the enforcer dropped, and find the rule that is missing.
---

Use this procedure after a change to a namespace's NetworkPolicies has
synced, or when a namespace's traffic stops working and a policy may be the
cause. Every namespace's own policies decide its traffic, from the first
packet after they sync.
[How network policy enforcement works here](/explanation/homelab/network-policy-enforcement/)
explains what the enforcer does and does not see.

You need cluster `kubectl` access, a tailnet connection and `toolkit`. Run the
`bun run` commands from `packages/homelab`, replacing `NAMESPACE`. They are
read-only.

The enforcer fails open. While `NetworkPolicyEnforcerNotRunning` or
`NetworkPolicyEnforcerRestarted` is firing, nothing here tells you whether the
policies are right. [Watching the enforcer](#watching-the-enforcer) lists what
reports it.

If production is down and cannot wait for a fix to merge and sync,
[open the namespace in an emergency](/how-to/open-a-namespace-in-an-emergency/)
first, then come back here.

## Check the namespace

1. Run the gate. It must exit zero:

   ```bash
   bun run netpol:check NAMESPACE
   ```

   | Check         | Passes when                                                           |
   | ------------- | --------------------------------------------------------------------- |
   | `break-glass` | No break-glass policy exists in the namespace                         |
   | `pods`        | Every pod is Ready and no container restarted in the window           |
   | `services`    | Every Service backed by pods has a ready endpoint                     |
   | `urls`        | The namespace's public and tailnet URLs answer as their probes expect |
   | `probes`      | Every blackbox probe of the namespace reports success                 |
   | `denials`     | Never fails. It counts the namespace's denials in Loki                |

   The restart and denial window is ten minutes. Widen it with
   `--since-minutes` when the change landed earlier than that.

   A `Failed` pod counts against `pods` only when it failed inside that
   window. One that failed earlier, such as a pod a node reboot left behind
   after its controller replaced it, is listed as `(not counted)`.
   Woodpecker step pods (label `ci.sjer.red/step-key`) and their per-step
   headless Services (`wp-hsvc-*`) are listed as `(not counted)` too: CI
   admission holds a step pod `SchedulingGated` until capacity frees, so a
   pipeline's result judges them, not this gate. Other `woodpecker-ci` pods
   and Services are checked as usual. A namespace scaled to zero has no pod to answer its URLs, so `urls` reports
   `namespace runs no pods` as INFO instead of requesting them. Scale the
   workload up first if its URLs are part of the evidence you need.

2. Exercise the namespace's own user flow. Sign in, load the page that calls
   its database, send the message, start the job. The gate only sees
   connections into the namespace. An outbound call the policy forgot fails
   here and nowhere else.

3. Read the denials for the window that covers step 2. The `denials` check
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
   one that needs the rule. Add a missing rule in the chart that renders the
   namespace's policies, merge it, and run this procedure again once it has
   synced.

   The **NetworkPolicy enforcement** Grafana dashboard (uid
   `network-policy-enforcement`) charts denials per node and direction over
   the same window, and its **Denials with their packets** panel shows these
   line pairs for every namespace.

4. Check the namespaces that call this one. Their Egress policies and this
   namespace's Ingress policy both have to allow a connection. Run the gate
   for each caller you know of.

To check every namespace that has a policy at once:

```bash
bun run netpol:check --all
```

## Watching the enforcer

These ship with the cluster's observability chart.

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
- [NetworkPolicy enforcement tooling](packages/homelab/README.md#networkpolicy-enforcement-tooling)
