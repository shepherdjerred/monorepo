---
title: How to switch on network policy enforcement
description: Run the maintenance window that upgrades Talos, starts the kube-network-policies enforcer beside flannel, and proves it enforces without blocking a staged namespace.
---

This guide runs the one maintenance window that makes NetworkPolicies real.
It upgrades both nodes to Talos 1.14.6, starts the `kube-network-policies`
enforcer in the `kube-flannel` DaemonSet, and restarts the workloads that
policies select. Every namespace with policies stays open through its staging
policy, so the switch itself should block nothing.

Run the steps in order from the reviewed checkout of the change that carries
the Talos pins. Each step ends with a decision. Do not start a step while the
previous decision is open.

:::caution
No audit mode exists. A pod that a policy selects is enforced from its first
packet once the enforcer runs. The staging policies are the only thing that
keeps today's behaviour.
:::

## What each step costs

| Step                         | Expected disruption                                                         |
| ---------------------------- | --------------------------------------------------------------------------- |
| 1. Preconditions             | None                                                                        |
| 2. Pause CI                  | No pipelines and no Delivery dispatch until step 12                         |
| 3. Upgrade `liskov`          | CI worker reboots; nothing in production moves                              |
| 4. Upgrade `torvalds`        | Full outage of the API server and every production pod for one reboot       |
| 5. Baseline manifest dry run | None; it pre-pulls nothing with the flags given                             |
| 6. Apply the switch          | None; only the rendered manifest changes                                    |
| 7. Dry run with the switch   | None                                                                        |
| 8. Sync the manifests        | `kube-flannel` pods restart one node at a time; running pods keep their IPs |
| 9. Confirm the enforcer runs | None                                                                        |
| 10. Restart workloads        | Each selected workload restarts once, PostgreSQL and Temporal included      |
| 11. Prove enforcement        | None; one throwaway namespace                                               |
| 12. Resume CI                | None                                                                        |

## 1. Check the preconditions

1. Every namespace with policies and pods has its staging policy:

   ```bash
   bun run --cwd packages/homelab netpol:check --coverage
   ```

2. Every staged namespace is open and healthy. Keep the output as the baseline
   for step 11:

   ```bash
   bun run --cwd packages/homelab netpol:check --all-staged --expect-stage open
   ```

3. The fleet summary is clean:

   ```bash
   toolkit ops summary
   ```

4. The promotion worker's seccomp profile is reviewed for the target release.
   Talos 1.14.3 and later ship containerd 2.3.7, whose default profile differs
   from the 2.3.6 one the
   [profile provenance](packages/homelab/src/talos/seccomp/promotion-policy.json)
   pins. Follow
   [Refresh a profile before upgrading its dependencies](/how-to/install-promotion-sandbox-prerequisites/#5-refresh-a-profile-before-upgrading-its-dependencies)
   first.

5. Take an etcd snapshot and keep the file until the window is closed:

   ```bash
   talosctl --nodes torvalds.tailnet-1a49.ts.net etcd snapshot \
     "etcd-pre-enforcement-$(date +%Y%m%d).snapshot"
   ```

6. Confirm a Velero backup completed within the last six hours. The scheduled
   `6hourly-backup-v2` backup is the volume backup of record:

   ```bash
   kubectl -n velero get backups.velero.io \
     --sort-by=.metadata.creationTimestamp \
     -o custom-columns=NAME:.metadata.name,PHASE:.status.phase,DONE:.status.completionTimestamp \
     | tail -n 3
   ```

   If the newest one is older or not `Completed`, start one and wait for it:

   ```bash
   velero backup create "pre-enforcement-$(date +%Y%m%d)" \
     --from-schedule 6hourly-backup-v2 --wait
   ```

7. Record the running versions. Both nodes must report Talos `v1.14.2` or a
   later 1.14 release, and Kubernetes `v1.37.1`:

   ```bash
   talosctl --endpoints liskov --nodes liskov version --short
   talosctl --nodes torvalds.tailnet-1a49.ts.net version --short
   kubectl get nodes -o wide
   ```

**Decision:** continue only if all seven hold. A failed namespace check now is
a failure the window would be blamed for later.

## 2. Pause CI

`liskov` starts hundreds of policy-selected step pods an hour. Stop them before
its reboot.

1. Pause the Woodpecker queue from the Woodpecker admin settings, on the Queue
   page. Then wait until nothing is running:

   ```bash
   toolkit ci load
   ```

   The report must show `paused=true` and `0 running`.

2. Pause Delivery dispatch:

   ```bash
   toolkit temporal --namespace prod schedule toggle \
     --schedule-id delivery-dispatch --pause \
     --reason 'Network policy enforcement window'
   toolkit deploy status --json | jq -r '.deployments[] | select(.status == "running") | .id'
   ```

   The second command must print nothing.

**Decision:** continue when both are quiet. **Rollback:** unpause both, as in
step 12.

## 3. Upgrade `liskov` to Talos 1.14.6

Run the `liskov` command from
[Upgrade Talos](packages/homelab/README.md#upgrade-talos), then check the node:

```bash
talosctl --endpoints liskov --nodes liskov version --short
kubectl get node liskov -o wide
```

**Decision:** continue when `liskov` reports `v1.14.6`, containerd `2.3.7`
and `Ready`. **Rollback:** `talosctl --endpoints liskov --nodes liskov rollback`
boots the previous installation. Stop here if `liskov` does not come back;
production has not been touched.

## 4. Upgrade `torvalds` to Talos 1.14.6

Run the `torvalds` command from
[Upgrade Talos](packages/homelab/README.md#upgrade-talos). The node reboots
once. The API server and every production workload are down until it returns.

```bash
talosctl --nodes torvalds.tailnet-1a49.ts.net version --short
talosctl --nodes torvalds.tailnet-1a49.ts.net health
kubectl get nodes -o wide
kubectl get --raw='/readyz?verbose'
toolkit ops summary
```

**Decision:** continue when both nodes report `v1.14.6`, the API server is
ready and the summary has settled to its step 1 state. **Rollback:**
`talosctl --nodes torvalds.tailnet-1a49.ts.net rollback`. Roll `liskov` back
too, so both nodes match the merged pins.

## 5. Dry-run the manifest sync before the switch

A Talos release carries its own bootstrap manifests. Talos 1.14.6 moves flannel
from `0.28.9` to `v0.28.10`. See that change alone first, so step 7 shows only
what the switch adds.

```bash
talosctl --endpoints torvalds.tailnet-1a49.ts.net \
  --nodes torvalds.tailnet-1a49.ts.net \
  upgrade-k8s --endpoint https://torvalds.tailnet-1a49.ts.net:6443 \
  --to 1.37.1 --pre-pull-images=false --upgrade-kubelet=false --dry-run
```

:::danger
The diff can include the bootstrap token Secret. Read it in the terminal. Never
paste it into a pull request, an issue or a chat.
:::

**Decision:** continue when the diff holds the flannel image change and nothing
you cannot explain. Keep a note of the objects it lists.

## 6. Apply the switch to `torvalds`

Only the control plane takes the switch. Talos rejects it on a worker, and the
control plane renders the DaemonSet for both nodes.

The live `torvalds` configuration still has the legacy `cluster.network`
section. Talos refuses the `KubeFlannelCNIConfig` document from
[the source patch](packages/homelab/src/talos/torvalds/patches/flannel-network-policies.yaml)
beside it, so the live change sets the same switch through the legacy key.

1. Preview the change. The output is the diff only:

   ```bash
   talosctl --nodes torvalds.tailnet-1a49.ts.net patch machineconfig \
     --mode no-reboot --dry-run \
     --patch $'cluster:\n  network:\n    cni:\n      name: flannel\n      flannel:\n        kubeNetworkPoliciesEnabled: true'
   ```

2. The diff must add exactly the `cni` block under `cluster.network`. Apply it
   by running the same command without `--dry-run`.

3. Read the key back, and confirm the rendered manifest now has the enforcer:

   ```bash
   talosctl --nodes torvalds.tailnet-1a49.ts.net get machineconfig v1alpha1 -o yaml \
     | yq '.spec' | yq 'select(.kind == null) | .cluster.network.cni'
   talosctl --nodes torvalds.tailnet-1a49.ts.net get manifests 05-flannel -o yaml \
     | grep -c 'kube-network-policies:v1.1.2'
   ```

   The second command must print `1`.

**Decision:** continue when both hold. Nothing in the cluster has changed yet.
**Rollback:** apply the same patch with `kubeNetworkPoliciesEnabled: false`.

## 7. Dry-run the manifest sync with the switch

Run the step 5 command again. Compared with step 5, the diff must add only:

| Object                               | Change                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| DaemonSet `kube-system/kube-flannel` | A second container, `kube-network-policies`, image `registry.k8s.io/networking/kube-network-policies:v1.1.2` |
| DaemonSet `kube-system/kube-flannel` | A `lib-modules` host volume mounted read-only into that container                                            |
| ClusterRole `flannel`                | `list` and `watch` on `networkpolicies` and on the `policy.networking.k8s.io` policy resources               |

The new container requests 100m CPU and 50Mi memory on each node, runs
privileged, and starts with `--v=2`.

**Decision:** continue only if the diff matches. Stop on a change to
`kube-proxy`, CoreDNS or any object that step 5 did not show.

## 8. Sync the manifests

```bash
talosctl --endpoints torvalds.tailnet-1a49.ts.net \
  --nodes torvalds.tailnet-1a49.ts.net \
  upgrade-k8s --endpoint https://torvalds.tailnet-1a49.ts.net:6443 \
  --to 1.37.1 --pre-pull-images=false --upgrade-kubelet=false
kubectl -n kube-system rollout status daemonset/kube-flannel --timeout=5m
```

The DaemonSet replaces one `kube-flannel` pod per node. Running pods keep their
sandboxes and addresses.

If a control-plane step waits on a config-version mismatch for more than a
minute, use the kubelet restart described under
[Upgrade Kubernetes](packages/homelab/README.md#upgrade-kubernetes).

**Decision:** continue when the rollout completes. **Rollback:** the
[full rollback](#roll-the-switch-back) below.

## 9. Confirm the enforcer runs on both nodes

```bash
kubectl -n kube-system get pods -l k8s-app=flannel -o wide
kubectl -n kube-system get pods -l k8s-app=flannel \
  -o jsonpath='{range .items[*]}{.spec.nodeName}{" "}{range .status.containerStatuses[*]}{.name}={.ready}/{.restartCount} {end}{"\n"}{end}'
kubectl -n kube-system logs daemonset/kube-flannel -c kube-network-policies --tail=20
kubectl top pods -n kube-system -l k8s-app=flannel --containers
bun run --cwd packages/homelab netpol:check --all-staged --expect-stage open
```

Both nodes must show `kube-network-policies=true/0`. Record the container's
CPU and memory use; `torvalds` has little memory to spare.

**Decision:** continue when both enforcers are ready with no restarts and the
namespace table matches step 1. If a namespace now fails, open it with
[the break-glass procedure](packages/homelab/README.md#break-glass) or roll the
switch back; do not go on to the restarts.

## 10. Restart the selected workloads

The enforcer never labels a connection that was open before it started. Once
a pod is isolated, replies on such a connection are judged as new inbound
connections and dropped. Restart every workload that a policy selects now,
while its namespace is still open, so its connections open under the enforcer.

1. Print the plan. The script only reads the cluster:

   ```bash
   bun run --cwd packages/homelab netpol:restart-plan > restart-plan.sh
   ```

2. Read `restart-plan.sh`. It lists PostgreSQL clusters first, then Temporal
   with its server first, then everything else. Each workload has a restart
   command and a wait command.

3. Run it one tier at a time. Stop at the first wait that fails:

   ```bash
   bash -e restart-plan.sh
   ```

4. Check the namespaces again:

   ```bash
   bun run --cwd packages/homelab netpol:check --all-staged --expect-stage open
   ```

Each PostgreSQL cluster in the plan has one replica, so its database is down
for the length of its restart. Pods the plan lists as not restarted, such as
running Jobs, keep their old connections until they end.

**Decision:** continue when every wait succeeded and the table still matches
step 1. **Rollback:** none needed for a restart; fix or open the failing
namespace before going on.

## 11. Prove a policy is enforced

Use a throwaway namespace with a deny policy and no staging policy.

1. Save this as `netpol-canary.yaml` and apply it:

   ```yaml
   apiVersion: v1
   kind: Namespace
   metadata:
     name: netpol-canary
   ---
   apiVersion: v1
   kind: Pod
   metadata:
     name: server
     namespace: netpol-canary
     labels:
       role: server
   spec:
     securityContext:
       runAsNonRoot: true
       runAsUser: 65534
       seccompProfile:
         type: RuntimeDefault
     containers:
       - name: server
         image: registry.k8s.io/e2e-test-images/agnhost:2.53
         args: ["netexec", "--http-port=8080"]
         securityContext:
           allowPrivilegeEscalation: false
           capabilities:
             drop: ["ALL"]
   ---
   apiVersion: v1
   kind: Pod
   metadata:
     name: client
     namespace: netpol-canary
   spec:
     securityContext:
       runAsNonRoot: true
       runAsUser: 65534
       seccompProfile:
         type: RuntimeDefault
     containers:
       - name: client
         image: registry.k8s.io/e2e-test-images/agnhost:2.53
         args: ["pause"]
         securityContext:
           allowPrivilegeEscalation: false
           capabilities:
             drop: ["ALL"]
   ```

   ```bash
   kubectl apply -f netpol-canary.yaml
   kubectl -n netpol-canary wait pod --all --for=condition=Ready --timeout=2m
   ```

2. Prove the path works without a policy. This must print `connected`:

   ```bash
   SERVER_IP=$(kubectl -n netpol-canary get pod server -o jsonpath='{.status.podIP}')
   kubectl -n netpol-canary exec client -- \
     /agnhost connect --timeout=5s "$SERVER_IP:8080" && echo connected
   ```

3. Deny all ingress to the server:

   ```bash
   kubectl apply -f - <<'EOF'
   apiVersion: networking.k8s.io/v1
   kind: NetworkPolicy
   metadata:
     name: deny-all-ingress
     namespace: netpol-canary
   spec:
     podSelector:
       matchLabels:
         role: server
     policyTypes: ["Ingress"]
   EOF
   ```

4. Repeat the request. It must now fail:

   ```bash
   kubectl -n netpol-canary exec client -- \
     /agnhost connect --timeout=5s "$SERVER_IP:8080"
   ```

   Expected output is `TIMEOUT` with exit code 1. A connection means the
   enforcer is not enforcing; go to the rollback.

5. Remove the canary, then run the gates:

   ```bash
   kubectl delete namespace netpol-canary
   bun run --cwd packages/homelab netpol:check --coverage
   bun run --cwd packages/homelab netpol:check --all-staged --expect-stage open
   toolkit ops summary
   ```

**Decision:** enforcement is on when the canary was blocked and every staged
namespace still passes.

## 12. Resume CI

Resume one layer at a time and require a result from each.

1. Resume the Woodpecker queue on the same admin page. Follow the next
   pipeline on `main` to a green result:

   ```bash
   toolkit ci load
   toolkit ci wait --main
   ```

2. Unpause Delivery dispatch and follow one deployment to acceptance:

   ```bash
   toolkit temporal --namespace prod schedule toggle \
     --schedule-id delivery-dispatch --unpause \
     --reason 'Network policy enforcement window closed'
   toolkit deploy status --json
   toolkit deploy wait DEPLOYMENT_ID --json
   ```

3. Record the node upgrades. After the change with the Talos pins merges and
   its `cluster-nodes` set revision exists, follow
   [Run an operator-run deployment](/how-to/cut-a-homelab-release/#run-an-operator-run-deployment)
   for `cluster-nodes/liskov`, then `cluster-nodes/torvalds`. Attest
   `talos-upgrade` with the versions from steps 3 and 4. Attest
   `kubernetes-upgrade` with the manifest sync from step 8; the Kubernetes
   version did not change.

**Decision:** the window is closed when a pipeline is green and a deployment
is accepted. If step pods fail to start or to reach their services, pause the
queue again and read the `woodpecker-ci` denials before anything else.

## Roll the switch back

Use this when the enforcer blocks traffic that an open namespace should pass,
or when it will not stay ready.

1. Turn the switch off:

   ```bash
   talosctl --nodes torvalds.tailnet-1a49.ts.net patch machineconfig \
     --mode no-reboot \
     --patch $'cluster:\n  network:\n    cni:\n      name: flannel\n      flannel:\n        kubeNetworkPoliciesEnabled: false'
   ```

2. Sync the manifests with the step 8 commands. The dry run from step 5 shows
   what it will remove.

3. Confirm the container is gone from both nodes:

   ```bash
   kubectl -n kube-system get daemonset kube-flannel \
     -o jsonpath='{.spec.template.spec.containers[*].name}{"\n"}'
   ```

The enforcer starts fail-open and does not delete its rules when it stops. The
nftables table `inet kube-network-policies` stays on each node. Its queue rules
carry the `bypass` flag, so packets pass while nothing listens on the queue.
The table goes away at the node's next reboot. Do not reboot `torvalds` only to
remove it.

The Talos upgrade is rolled back separately, per node, as in steps 3 and 4. It
does not depend on the switch.

## Known enforcer behaviour in v1.1.2

Talos 1.14.6 pins `kube-network-policies` v1.1.2. The fixes below are in
v1.1.3, which no Talos 1.14 release carries.

| Symptom                                                                                              | Upstream issue                                                                               | What to do                                                      |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Replies dropped on connections that were open before the enforcer started, for about fifteen minutes | [#418](https://github.com/kubernetes-sigs/kube-network-policies/issues/418)                  | Step 10. Restart any pod that step 10 could not                 |
| HTTPS probe connections from the node never finish closing; the probes still pass                    | [#417](https://github.com/kubernetes-sigs/kube-network-policies/issues/417)                  | Ignore the drops from the node's address                        |
| A closing packet of an unlabelled connection is logged as a denied connection                        | [#440](https://github.com/kubernetes-sigs/kube-network-policies/issues/440), still open      | Do not read one `deny` line for an old connection as a real one |
| No deny-only log; `--v=2` traces every queued packet                                                 | [v1.1.3 notes](https://github.com/kubernetes-sigs/kube-network-policies/releases/tag/v1.1.3) | Expect a large log from the container; watch log ingestion      |

The enforcer also serves unauthenticated Prometheus metrics on port 9080 of
every node address, tailnet and LAN included
([Talos #14769](https://github.com/siderolabs/talos/issues/14769)). It exposes
runtime and policy counters, and no API. This change does not firewall the
port. On Talos 1.14 the first `NetworkRuleConfig` on a node also creates the
host ingress chain, which
[drops every packet conntrack marks invalid](https://github.com/siderolabs/talos/blob/v1.14.6/internal/app/machined/pkg/controllers/network/nftables_chain_config.go),
on all ports. That is a second change to production networking that this
window should not carry. Talos 1.15 adds `kubeNetworkPoliciesArgs`, which can
bind the listener to loopback.

## Related

- [Talos machine configuration source](packages/homelab/src/talos/README.md)
- [NetworkPolicy enforcement tooling](packages/homelab/README.md#networkpolicy-enforcement-tooling)
- [Cut a homelab release](/how-to/cut-a-homelab-release/)
- [Install promotion sandbox prerequisites](/how-to/install-promotion-sandbox-prerequisites/)
- How network policy enforcement works here: `/explanation/homelab/network-policy-enforcement/`
- Cut a namespace over to enforced policies: `/how-to/cut-a-namespace-over-to-enforced-policies/`
- Open a namespace in an emergency: `/how-to/open-a-namespace-in-an-emergency/`

## References

- [Talos `KubeFlannelCNIConfig` reference](https://docs.siderolabs.com/talos/v1.14/reference/configuration/kubernetes/kubeflannelcniconfig)
- [Talos flannel guide](https://docs.siderolabs.com/kubernetes-guides/cni/flannel)
- [Talos ingress firewall](https://docs.siderolabs.com/talos/v1.14/networking/ingress-firewall)
- [Talos Kubernetes upgrade and manifest sync](https://docs.siderolabs.com/kubernetes-guides/advanced-guides/upgrading-kubernetes)
- [Talos 1.14.6 release](https://github.com/siderolabs/talos/releases/tag/v1.14.6)
- [Enforcer pin in Talos 1.14.6](https://github.com/siderolabs/talos/blob/v1.14.6/pkg/machinery/constants/constants.go)
- [Enforcer pin in Talos 1.14.2](https://github.com/siderolabs/talos/blob/v1.14.2/pkg/machinery/constants/constants.go)
- [Control-plane-only and legacy-conflict rules of the flannel document](https://github.com/siderolabs/talos/blob/v1.14.6/pkg/machinery/config/types/k8s/flannel.go)
- [Enforcer shutdown and fail-open rules](https://github.com/kubernetes-sigs/kube-network-policies/blob/v1.1.2/pkg/dataplane/controller.go)
- [Enforcer flags](https://github.com/kubernetes-sigs/kube-network-policies/blob/v1.1.2/pkg/cmd/cmd.go)
