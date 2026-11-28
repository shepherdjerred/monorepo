---
title: Clear a stale field manager
description: Remove a manual kubectl field manager that keeps a server-side-applied resource from dropping a container or volume, without changing the running workload.
---

Use this when apply safety refuses a sync with "still co-owns", or when Argo
reports a `ComparisonError` whose server-side dry-run names a duplicate
container or volume. A manager other than `argocd-controller`, usually
`kubectl-patch`, `kubectl-edit` or `kubectl-set` left behind by a manual
change, still owns the entry, and server-side apply keeps any entry another
manager owns. You need cluster-admin `kubectl` access and authorization to
change that resource. Removing a managedFields entry changes metadata only:
the pod template, generation and running pods stay as they are.

:::caution
Clear only a manager that a person or a one-off script created. Do not clear
operators that own their fields on purpose, such as `postgres-operator`,
`PrometheusOperator` or `talos`. Fix those in the chart or the operator
instead.
:::

## 1. Inspect the managers

List the managers with their positions, and note the exact index and time of
the stale one:

```bash
kubectl -n NAMESPACE get KIND NAME -o json --show-managed-fields \
  | jq -r '.metadata.managedFields | to_entries[] | "\(.key)\t\(.value.manager)\t\(.value.operation)\t\(.value.time)\t\(.value.subresource // "")"'
```

Confirm that the stale manager owns the entry the refusal names, and that the
chart no longer declares that entry:

```bash
kubectl -n NAMESPACE get KIND NAME -o json --show-managed-fields \
  | jq '.metadata.managedFields[INDEX].fieldsV1 | paths | map(tostring) | join("/")' \
  | grep -v -iE 'secret|password|key'
```

Save the manager list as the "before" evidence. Record only names, operations
and times, never field values.

## 2. Dry-run a guarded removal

The `test` operations make the patch fail if the list changed after you read
it:

```bash
cat > /tmp/clear-manager.json <<'EOF'
[
  {"op": "test", "path": "/metadata/managedFields/INDEX/manager", "value": "MANAGER"},
  {"op": "test", "path": "/metadata/managedFields/INDEX/time", "value": "TIME"},
  {"op": "remove", "path": "/metadata/managedFields/INDEX"}
]
EOF
kubectl -n NAMESPACE patch KIND NAME --type=json \
  -p "$(cat /tmp/clear-manager.json)" --dry-run=server -o json --show-managed-fields \
  | jq -r '.metadata.generation, (.metadata.managedFields[].manager)'
```

The generation must be unchanged, and the stale manager must be gone from the
list.

## 3. Apply it and prove the sync now applies

1. Run the same `kubectl patch` without `--dry-run=server`.
2. Read the managers again and save them as the "after" evidence. Check that
   `.spec` is unchanged.
3. Server-side dry-run the rendered target as Argo's manager. It must succeed
   without the duplicate or co-owned entry:

   ```bash
   kubectl apply --server-side --dry-run=server \
     --field-manager=argocd-controller -n NAMESPACE -f RENDERED_RESOURCE.yaml
   ```

4. Reproduce the preflight read-only. It must report no finding for the
   resource:

   ```bash
   bun packages/homelab/scripts/argocd/argocd.ts assert-apply-safe APP --revision CHART_VERSION
   ```

## 4. Record it and release normally

Post the before and after manager lists, the patch time and the dry-run
results on the incident's forum thread and Tracker issue. Then let Delivery's
next deployment for that environment sync the resource. Never run a plain
`argocd app sync`.

## Related

- [Why releases are shaped this way](/explanation/homelab/release-safety/)
- [Regain write access to ArgoCD](/how-to/regain-write-access-to-argocd/)
- [Cut a homelab release](/how-to/cut-a-homelab-release/)
